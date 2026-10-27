
import type { ProviderClient, FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { splitLocation } from '../util';

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayFacetValue {
  descriptor?: string;
  id?: string;
  count?: number;
}

interface WorkdayFacet {
  facetParameter?: string;
  values?: WorkdayFacetValue[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
  facets?: WorkdayFacet[];
}

export interface WorkdayCoords {
  host: string;
  tenant: string;
  site: string;
}

type WorkdayItem = WorkdayPosting & {
  __coords: WorkdayCoords;
};

export function parseWorkdayToken(
  token: string,
): WorkdayCoords | null {
  const parts = token.split('|');

  if (
    parts.length !== 3 ||
    parts.some((part) => !part.trim())
  ) {
    return null;
  }

  const [host, tenant, site] = parts;

  if (
    !/^[a-z0-9.-]+\.myworkday(?:jobs|site)\.com$/i.test(host)
  ) {
    return null;
  }

  return { host, tenant, site };
}

const PAGE_SIZE = 20;
const MAX_PAGES = 250;
const BOARD_CAP = PAGE_SIZE * MAX_PAGES;

/** A board bigger than the page cap cannot be finished. An internship category that fits can. */
function selectInternshipFacet(
  facets: WorkdayFacet[] | undefined,
): { parameter: string; id: string; label: string; count: number } | null {
  const matches: Array<{ parameter: string; id: string; label: string; count: number; rank: number }> = [];
  for (const facet of facets ?? []) {
    if (!facet.facetParameter) continue;
    for (const value of facet.values ?? []) {
      const label = value.descriptor?.trim() ?? '';
      if (!value.id || !label || typeof value.count !== 'number') continue;
      if (value.count < 1 || value.count > BOARD_CAP) continue;
      if (!/intern|early career|university|campus|new grad|student/i.test(label)) continue;
      matches.push({
        parameter: facet.facetParameter,
        id: value.id,
        label,
        count: value.count,
        rank: /internship/i.test(label) ? 2 : 1,
      });
    }
  }
  matches.sort((a, b) => b.rank - a.rank || b.count - a.count);
  return matches[0] ?? null;
}

export function createWorkdayClient(
  fetchImpl: FetchLike = fetch,
): ProviderClient<WorkdayItem> {
  let completeSnapshot = false;

  return {
    provider: 'workday',

    isCompleteSnapshot: () => completeSnapshot,

    async fetchPostings(token, signal) {
      completeSnapshot = false;

      const coords = parseWorkdayToken(token);

      if (!coords) {
        throw new Error(
          `Workday: malformed board token ${token}`,
        );
      }

      const { host, tenant, site } = coords;

      const endpoint =
        `https://${host}/wday/cxs/` +
        `${encodeURIComponent(tenant)}/` +
        `${encodeURIComponent(site)}/jobs`;

      const collected: WorkdayItem[] = [];
      const seen = new Set<string>();
      let appliedFacets: Record<string, string[]> = {};
      let narrowed = false;
      let total: number | null = null;
      let reachedEnd = false;
      const missed = new Set<number>();

      const ingest = (data: WorkdayResponse) => {
        for (const posting of data.jobPostings ?? []) {
          if (!posting?.externalPath || seen.has(posting.externalPath)) continue;
          seen.add(posting.externalPath);
          collected.push({ ...posting, __coords: coords });
        }
      };

      const loadPage = async (offset: number): Promise<{ data: WorkdayResponse | null; status: number }> => {
        if (signal?.aborted) return { data: null, status: 0 };
        try {
          const res = await fetchRetrying(
            fetchImpl,
            endpoint,
            {
              method: 'POST',
              signal,
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                appliedFacets,
                limit: PAGE_SIZE,
                offset,
                searchText: '',
              }),
            },
            `Workday ${tenant} offset ${offset}`,
          );
          if (!res.ok) return { data: null, status: res.status };
          const data = (await res.json()) as WorkdayResponse;
          if (!Array.isArray(data.jobPostings)) return { data: null, status: res.status };
          return { data, status: res.status };
        } catch (error) {
          if (signal?.aborted) return { data: null, status: 0 };
          throw error;
        }
      };

      for (let page = 0; page < MAX_PAGES; page++) {
        if (signal?.aborted) break;
        const offset = page * PAGE_SIZE;
        const loaded = await loadPage(offset);
        const data = loaded.data;

        if (!data) {
          if (signal?.aborted) break;
          if (total == null && collected.length === 0 && page === 0) {
            throw new Error(`Workday ${tenant}: HTTP ${loaded.status} on the first page`);
          }
          missed.add(offset);
          console.log(`Workday ${tenant}: offset ${offset} failed; reading the following pages anyway`);
          if (total != null && offset + PAGE_SIZE >= total) break;
          continue;
        }

        if (
          page === 0 &&
          !narrowed &&
          typeof data.total === 'number' &&
          data.total > BOARD_CAP
        ) {
          const pick = selectInternshipFacet(data.facets);
          if (pick) {
            console.log(
              `Workday ${tenant}: ${data.total} jobs on the board; ` +
              `downloading ${pick.label} (${pick.count}) so the internship list can finish`,
            );
            appliedFacets = { [pick.parameter]: [pick.id] };
            narrowed = true;
            total = null;
            page = -1;
            continue;
          }
        }

        if (typeof data.total === 'number') total = data.total;
        ingest(data);

        const count = data.jobPostings!.length;
        const covered = offset + count;
        if ((total != null && covered >= total) || count === 0 || (total == null && count < PAGE_SIZE)) {
          reachedEnd = true;
          break;
        }
      }

      for (const offset of [...missed]) {
        if (signal?.aborted) break;
        const data = await loadPage(offset);
        if (!data.data) continue;
        missed.delete(offset);
        ingest(data.data);
      }

      if (signal?.aborted) {
        console.log(`Workday ${tenant}: time ran out; saving ${collected.length} jobs already read`);
      } else if (missed.size > 0) {
        console.log(
          `Workday ${tenant}: saved ${collected.length} jobs; ${missed.size} pages were still down and were not dropped`,
        );
      } else {
        console.log(`Workday ${tenant}: read ${collected.length} jobs`);
      }

      completeSnapshot = reachedEnd && missed.size === 0 && !signal?.aborted && !narrowed;
      return collected;
    },

    toNormalized(raw) {
      if (
        !raw?.title ||
        !raw.externalPath
      ) {
        return null;
      }

      const { host, tenant, site } = raw.__coords;
      const onRecruitingSite = host.toLowerCase().endsWith('.myworkdaysite.com');
      const applyUrl = onRecruitingSite
        ? `https://${host}/recruiting/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${raw.externalPath}`
        : `https://${host}/en-US/${encodeURIComponent(site)}${raw.externalPath}`;

      // Preserve the original Workday job identifier.
      // This prevents existing roles from being duplicated.
      const externalJobId =
        raw.bulletFields?.[0] ??
        raw.externalPath.split('_').pop() ??
        raw.externalPath;

      const locationText =
        (raw.locationsText ?? '').trim();

      const remote =
        /remote/i.test(locationText);

      const invalidLocation =
        !locationText ||
        /\blocations?\b/i.test(locationText) ||
        /^(location\s*)?n\/?a$/i.test(
          locationText,
        );

      const location =
        remote || invalidLocation
          ? {}
          : splitLocation(locationText);

      return {
        externalJobId,
        title: raw.title,
        descriptionHtml: '',
        applyUrl,
        ...location,
        workArrangement: remote
          ? 'Remote'
          : undefined,
        updatedAt: undefined,
      };
    },
  };
}
