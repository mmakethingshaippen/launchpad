import type { FetchLike } from '../types';
import type { AggregatedPosting, AggregatorClient } from './types';

/**
 * USAJOBS connector — federal student / recent-graduate openings.
 *
 * USAJOBS requires a (free) API key. It is read from the environment only; the
 * key is never requested in chat, never logged, and never shipped to the
 * browser (this runs server-side via the CLI / serverless sync). When the key
 * is absent we skip cleanly so keyless local dev still works.
 *
 *   https://data.usajobs.gov/api/Search?HiringPath=student&ResultsPerPage=100
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
    SearchResultItems?: UsaJobsItem[];
  };
}

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

  return {
    source: 'usajobs',
    enabled,
    async fetchEarlyCareer(signal) {
      if (!enabled) {
        // eslint-disable-next-line no-console
        console.log('Skipping USAJOBS: USAJOBS_API_KEY not set');
        return [];
      }
      const url =
        'https://data.usajobs.gov/api/Search?HiringPath=student&ResultsPerPage=100';
      const res = await fetchImpl(url, {
        signal,
        headers: {
          'Authorization-Key': apiKey!,
          'User-Agent': userAgent || 'launchpad-jobs',
          Host: 'data.usajobs.gov',
        },
      });
      if (!res.ok) throw new Error(`USAJOBS: HTTP ${res.status}`);
      const data = (await res.json()) as UsaJobsResponse;

      const out: AggregatedPosting[] = [];
      for (const item of data.SearchResult?.SearchResultItems ?? []) {
        const d = item.MatchedObjectDescriptor;
        if (!d) continue;
        const title = d.PositionTitle?.trim();
        const applyUrl = (d.ApplyURI && d.ApplyURI[0]) || d.PositionURI;
        const companyName = d.OrganizationName || d.DepartmentName;
        if (!title || !applyUrl || !companyName) continue;

        out.push({
          source: 'usajobs',
          companyName: companyName.trim(),
          externalJobId: `usajobs-${item.MatchedObjectId ?? applyUrl}`,
          title,
          descriptionHtml: d.UserArea?.Details?.JobSummary ?? '',
          applyUrl,
          ...parseLocation(d.PositionLocation),
          employmentTypeRaw: 'student',
          updatedAt: d.PublicationStartDate || d.PositionStartDate,
        });
      }
      return out;
    },
  };
}
