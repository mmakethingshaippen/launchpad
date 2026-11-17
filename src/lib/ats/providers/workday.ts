
import type { ProviderClient, FetchLike, ProviderCoverage } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { splitLocation } from '../util';
import { describeJsonFailure, readJsonResponse } from '../jsonResponse';

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
/**
 * Workday reports at most this many jobs in `total`, even when more exist (NVIDIA, Citi, T-Mobile and
 * Applied Materials returned 2000 and still served jobs at offset 2000). A total at the cap is a lower
 * bound, so the board is read until a short or empty page instead.
 */
const TOTAL_CAP = 2000;
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
      // Whole words: Citi's "Internal Audit" facet matched a bare /intern/ and replaced the internship list.
      if (!/\b(intern|interns|internship|internships|early careers?|university|campus|new grads?|students?)\b/i.test(label)) continue;
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
  let coverage: ProviderCoverage = { status: 'partial', reason: 'not started' };

  return {
    provider: 'workday',

    isCompleteSnapshot: () => completeSnapshot,
    getFetchCoverage: () => ({ ...coverage }),

    async fetchPostings(token, signal) {
      completeSnapshot = false;
      coverage = { status: 'partial', reason: 'download not completed' };

      const coords = parseWorkdayToken(token);

      if (!coords) {
        throw new Error(
          `Workday: malformed board token ${token}`,
        );
      }

      const { host, tenant, site } = coords;
      coverage.host = host;

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
      let stopReason: string | null = null;
      let hostBlocked = false;

      /** Adds unseen postings and returns how many were new. */
      const ingest = (data: WorkdayResponse): number => {
        let added = 0;
        for (const posting of data.jobPostings ?? []) {
          if (!posting?.externalPath || seen.has(posting.externalPath)) continue;
          seen.add(posting.externalPath);
          collected.push({ ...posting, __coords: coords });
          added += 1;
        }
        return added;
      };

      const loadPage = async (offset: number): Promise<{ data: WorkdayResponse | null; status: number; failure?: string; blocked?: boolean }> => {
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
          // Validate before parsing: a tenant under maintenance answers 200 with an HTML page.
          const read = await readJsonResponse<WorkdayResponse>(res, endpoint);
          if (!read.ok) return { data: null, status: res.status, failure: describeJsonFailure(read), blocked: read.kind === 'access-challenge' };
          if (!read.data || !Array.isArray(read.data.jobPostings)) {
            return { data: null, status: res.status, failure: 'unexpected-response: no jobPostings array' };
          }
          return { data: read.data, status: res.status };
        } catch (error) {
          if (signal?.aborted) return { data: null, status: 0 };
          // A late network failure must not discard pages already downloaded.
          return { data: null, status: 0, failure: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network-error' };
        }
      };

      for (let page = 0; page < MAX_PAGES; page++) {
        if (signal?.aborted) break;
        const offset = page * PAGE_SIZE;
        const loaded = await loadPage(offset);
        const data = loaded.data;

        if (!data) {
          if (signal?.aborted) break;
          if (loaded.blocked) {
            hostBlocked = true;
            stopReason = loaded.failure ?? 'access-challenge';
            coverage = { status: 'blocked', reason: stopReason, host };
          }
          if (total == null && collected.length === 0 && page === 0) {
            throw new Error(`Workday ${tenant}: ${loaded.failure ?? `HTTP ${loaded.status}`} on the first page`);
          }
          if (hostBlocked) break;
          missed.add(offset);
          console.log(`Workday ${tenant}: offset ${offset} failed (${loaded.failure ?? `HTTP ${loaded.status}`}); reading the following pages anyway`);
          if (total != null && offset + PAGE_SIZE >= total) break;
          continue;
        }

        if (
          page === 0 &&
          !narrowed &&
          typeof data.total === 'number' &&
          // Above the reported-total cap the full list cannot be read to the end either.
          data.total >= Math.min(BOARD_CAP, TOTAL_CAP)
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

        // Only the first page of a query carries a meaningful total. 14 of 21 configured tenants return
        // total: 0 on later pages; taking it from every page ended the read after 40 jobs, reported the
        // board as complete, and let sync close every other job on it.
        if (page === 0 && typeof data.total === 'number') total = data.total >= TOTAL_CAP ? null : data.total;
        const added = ingest(data);
        if (added === 0 && (data.jobPostings?.length ?? 0) > 0) {
          // Past Workday's 2000-job window the API repeats earlier postings. The list is capped, not finished.
          console.log(`Workday ${tenant}: offset ${offset} repeated earlier jobs; the list is capped at ${collected.length} and is incomplete`);
          stopReason = 'API repeated earlier jobs; board is capped';
          break;
        }

        const count = data.jobPostings!.length;
        const covered = offset + count;
        if (total != null && covered >= total) {
          reachedEnd = true;
          break;
        }
        if (count === 0 || (total == null && count < PAGE_SIZE)) {
          if (total != null && covered < total) {
            missed.add(offset);
            console.log(`Workday ${tenant}: offset ${offset} came back empty; reading the following pages anyway`);
            continue;
          }
          reachedEnd = true;
          break;
        }
      }

      for (let round = 0; round < 4 && missed.size > 0 && !signal?.aborted && !hostBlocked; round++) {
        if (round > 0 && !process.env.VITEST) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        for (const offset of [...missed]) {
          if (signal?.aborted) break;
          const data = await loadPage(offset);
          if (data.blocked) {
            hostBlocked = true;
            stopReason = data.failure ?? 'access-challenge';
            break;
          }
          if (!data.data || data.data.jobPostings?.length === 0) continue;
          missed.delete(offset);
          ingest(data.data);
        }
      }

      if (hostBlocked) {
        console.log(`Workday ${tenant}: blocked; saving ${collected.length} jobs already read; no more requests to this board this run`);
      } else if (signal?.aborted) {
        console.log(`Workday ${tenant}: time ran out; saving ${collected.length} jobs already read`);
      } else if (missed.size > 0) {
        console.log(
          `Workday ${tenant}: saved ${collected.length} jobs; ${missed.size} pages were still down and were not dropped`,
        );
      } else {
        console.log(`Workday ${tenant}: read ${collected.length} jobs`);
      }

      completeSnapshot = reachedEnd && missed.size === 0 && !signal?.aborted && !narrowed;
      coverage = {
        status: hostBlocked ? 'blocked' : signal?.aborted || missed.size > 0 || !reachedEnd ? 'partial' : narrowed ? 'filtered' : 'complete',
        reason: stopReason ?? (signal?.aborted ? 'download deadline reached' : missed.size > 0 ? `${missed.size} page(s) unread` : !reachedEnd ? 'page limit reached' : narrowed ? 'internship facet only; absent jobs need individual checks' : 'full board read'),
        host,
      };
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
