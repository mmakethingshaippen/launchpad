
import type { ProviderClient, FetchLike } from '../types';
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
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      for (
        let page = 0;
        page < MAX_PAGES;
        page++
      ) {
        const offset = page * PAGE_SIZE;
        let res: { ok: boolean; status: number; json: () => Promise<unknown> } | null = null;

        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
          res = await fetchImpl(endpoint, {
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
          });
          if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === RETRY_DELAYS_MS.length) break;
          console.log(
            `Workday ${tenant}: HTTP ${res.status} on page ${page + 1}; retrying`,
          );
          await wait(RETRY_DELAYS_MS[attempt]);
        }

        if (!res?.ok) {
          if (collected.length > 0) {
            console.log(
              `Workday ${tenant}: HTTP ${res?.status ?? 0} on page ${page + 1}; ` +
              `keeping ${collected.length} jobs already read and leaving the rest open`,
            );
            break;
          }
          throw new Error(
            `Workday ${tenant}: HTTP ${res?.status ?? 0} ` +
            `on page ${page + 1}`,
          );
        }

        const data =
          (await res.json()) as WorkdayResponse;

        if (!Array.isArray(data.jobPostings)) {
          throw new Error(
            `Workday ${tenant}: invalid jobs response`,
          );
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
            page = -1;
            continue;
          }
        }

        let newItems = 0;

        for (const posting of data.jobPostings) {
          if (!posting?.externalPath) {
            continue;
          }

          if (seen.has(posting.externalPath)) {
            continue;
          }

          seen.add(posting.externalPath);

          collected.push({
            ...posting,
            __coords: coords,
          });

          newItems++;
        }

        if (data.jobPostings.length === 0) {
          completeSnapshot = true;
          break;
        }

        if (
          typeof data.total === 'number' &&
          offset + data.jobPostings.length >=
            data.total
        ) {
          completeSnapshot = true;
          break;
        }

        if (
          data.jobPostings.length < PAGE_SIZE
        ) {
          completeSnapshot = true;
          break;
        }

        if (newItems === 0) {
          throw new Error(
            `Workday ${tenant}: pagination ` +
            `stopped making progress`,
          );
        }
      }

      // A filtered internship download refreshes those roles. It is not the
      // whole board, so roles that were not in the filter stay up.
      if (narrowed) completeSnapshot = false;

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
