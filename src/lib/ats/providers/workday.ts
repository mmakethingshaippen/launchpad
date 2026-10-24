import type { ProviderClient, FetchLike } from '../types';
import { splitLocation } from '../util';

/**
 * Workday public CXS JSON connector.
 *
 * Workday tenants expose a keyless search endpoint:
 *   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *   body { appliedFacets:{}, limit, offset, searchText }
 * returning { total, jobPostings: [{ title, externalPath, locationsText, bulletFields }] }.
 *
 * The canonical apply URL is: https://{host}/en-US/{site}{externalPath}.
 *
 * The board "token" for this provider encodes the tenant coordinates as
 * "host|tenant|site" (e.g. "nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite").
 */
interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}
interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

export interface WorkdayCoords {
  host: string;
  tenant: string;
  site: string;
}

export function parseWorkdayToken(token: string): WorkdayCoords | null {
  const parts = token.split('|');
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  return { host: parts[0], tenant: parts[1], site: parts[2] };
}

const PAGE_LIMIT = 20;
const MAX_PAGES = 5; // up to 100 intern-matching postings per tenant

export function createWorkdayClient(fetchImpl: FetchLike = fetch): ProviderClient<WorkdayPosting & { __coords: WorkdayCoords }> {
  return {
    provider: 'workday',
    // This search is capped and only matches "intern"; absence is not proof of closure.
    isCompleteSnapshot: () => false,
    async fetchPostings(token, signal) {
      const coords = parseWorkdayToken(token);
      if (!coords) throw new Error(`Workday ${token}: malformed token (expected host|tenant|site)`);
      const { host, tenant, site } = coords;
      const base = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

      const collected: Array<WorkdayPosting & { __coords: WorkdayCoords }> = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchImpl(base, {
          signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE_LIMIT,
            offset: page * PAGE_LIMIT,
            searchText: 'intern',
          }),
        });
        if (!res.ok) throw new Error(`Workday ${tenant}: HTTP ${res.status} on page ${page + 1}`);
        const data = (await res.json()) as WorkdayResponse;
        const batch = data.jobPostings ?? [];
        for (const p of batch) collected.push({ ...p, __coords: coords });
        if (batch.length < PAGE_LIMIT) break;
      }
      return collected;
    },
    toNormalized(raw) {
      if (!raw || !raw.title || !raw.externalPath) return null;
      const { host, site } = raw.__coords;
      const applyUrl = `https://${host}/en-US/${site}${raw.externalPath}`;
      const externalJobId = raw.bulletFields?.[0] ?? raw.externalPath.split('_').pop() ?? raw.externalPath;

      const locText = (raw.locationsText ?? '').trim();
      const remote = /remote/i.test(locText);
      // Workday locationsText can be "City, State", a multi-office count
      // ("2 Locations"), or junk ("N/A"). Only split a single real place; for
      // everything else emit no city so the sink falls back to the company HQ.
      const looksBad =
        !locText ||
        /\blocations?\b/i.test(locText) ||
        /^(location\s*)?n\/?a$/i.test(locText);
      const loc = remote || looksBad ? {} : splitLocation(locText);

      return {
        externalJobId: String(externalJobId),
        title: raw.title,
        descriptionHtml: '',
        applyUrl,
        ...loc,
        workArrangement: remote ? 'Remote' : undefined,
        employmentTypeRaw: 'Intern',
      };
    },
  };
}
