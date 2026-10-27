import type { FetchLike } from '../types';
import { fetchRetrying, TRANSIENT_HTTP } from '../fetchRetry';
import type { AggregatedPosting, AggregatorClient } from './types';

/**
 * USAJOBS connector — federal student / recent-graduate openings.
 *
 * USAJOBS requires a (free) API key. It is read from the environment only; the
 * key is never requested in chat, never logged, and never shipped to the
 * browser (this runs server-side via the CLI / serverless sync). When the key
 * is absent we skip cleanly so keyless local dev still works.
 *
 *   https://data.usajobs.gov/api/Search?HiringPath=student&ResultsPerPage=500&Page=1
 *   Headers: Authorization-Key: <key>, User-Agent: <contact email>
 */

interface UsaJobsPositionLocation {
  LocationName?: string;
  CountrySubDivisionCode?: string;
  CountryCode?: string;
  CityName?: string;
}
interface UsaJobsDescriptor {
  PositionTitle?: string;
  PositionURI?: string;
  ApplyURI?: string[];
  OrganizationName?: string;
  DepartmentName?: string;
  PositionLocation?: UsaJobsPositionLocation[];
  UserArea?: { Details?: { JobSummary?: string } };
  PositionStartDate?: string;
  PublicationStartDate?: string;
}
interface UsaJobsItem {
  MatchedObjectId?: string;
  MatchedObjectDescriptor?: UsaJobsDescriptor;
}
interface UsaJobsResponse {
  SearchResult?: {
    SearchResultCountAll?: number;
    SearchResultItems?: UsaJobsItem[];
  };
}

const PAGE_SIZE = 500;
/** Safety stop only. Paging ends earlier when USAJOBS returns a short page. */
const MAX_PAGES = 40;

function parseLocation(locs: UsaJobsPositionLocation[] | undefined): {
  city?: string;
  state?: string;
  country?: string;
} {
  const first = locs?.[0];
  if (!first) return {};
  const city = first.CityName || first.LocationName?.split(',')[0]?.trim();
  return {
    city: city || undefined,
    state: first.CountrySubDivisionCode || undefined,
    country: first.CountryCode || undefined,
  };
}

export function createUsaJobsClient(
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = typeof process !== 'undefined' ? process.env : {},
): AggregatorClient & { enabled: boolean } {
  const apiKey = env.USAJOBS_API_KEY;
  const userAgent = env.USAJOBS_USER_AGENT;
  const enabled = Boolean(apiKey);

  let feedComplete = false;
  return {
    source: 'usajobs',
    enabled,
    feedWasComplete: () => feedComplete,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      if (!enabled) {
        // eslint-disable-next-line no-console
        console.log('Skipping USAJOBS: USAJOBS_API_KEY not set');
        return [];
      }

      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();
      let stoppedEarly = false;
      let skippedPages = 0;
      let previousFirstId: string | undefined;
      const headers = {
        'Authorization-Key': apiKey!,
        'User-Agent': userAgent || 'launchpad-jobs',
        Host: 'data.usajobs.gov',
      };

      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          `https://data.usajobs.gov/api/Search?HiringPath=student` +
          `&ResultsPerPage=${PAGE_SIZE}&Page=${page}`;
        const res = await fetchRetrying(fetchImpl, url, { signal, headers }, `USAJOBS page ${page}`);
        if (!res.ok) {
          if (page === 1 && out.length === 0) throw new Error(`USAJOBS: HTTP ${res.status}`);
          stoppedEarly = true;
          if (!TRANSIENT_HTTP.has(res.status) || skippedPages >= 2) {
            console.error(`USAJOBS: stopped on page ${page}: HTTP ${res.status}`);
            break;
          }
          skippedPages += 1;
          console.error(`USAJOBS: HTTP ${res.status} on page ${page}; skipping that page`);
          continue;
        }
        skippedPages = 0;
        const data = (await res.json()) as UsaJobsResponse;
        const items = data.SearchResult?.SearchResultItems ?? [];
        if (items.length === 0) break;
        const firstId = items[0]?.MatchedObjectId;
        if (firstId && firstId === previousFirstId) break;
        previousFirstId = firstId;

        for (const item of items) {
          const d = item.MatchedObjectDescriptor;
          if (!d) continue;
          const title = d.PositionTitle?.trim();
          const applyUrl = (d.ApplyURI && d.ApplyURI[0]) || d.PositionURI;
          const companyName = d.OrganizationName || d.DepartmentName;
          if (!title || !applyUrl || !companyName) continue;

          const externalJobId = `usajobs-${item.MatchedObjectId ?? applyUrl}`;
          if (seen.has(externalJobId)) continue;
          seen.add(externalJobId);

          out.push({
            source: 'usajobs',
            companyName: companyName.trim(),
            externalJobId,
            title,
            descriptionHtml: d.UserArea?.Details?.JobSummary ?? '',
            applyUrl,
            ...parseLocation(d.PositionLocation),
            employmentTypeRaw: 'student',
            updatedAt: d.PublicationStartDate || d.PositionStartDate,
          });
        }

        const total = data.SearchResult?.SearchResultCountAll;
        if (items.length < PAGE_SIZE) break;
        if (typeof total === 'number' && page * PAGE_SIZE >= total) break;
        if (page === MAX_PAGES) {
          console.error(`USAJOBS: safety stop at ${MAX_PAGES} pages; more results may remain`);
          stoppedEarly = true;
        }
      }
      feedComplete = !stoppedEarly;
      return out;
    },
  };
}
