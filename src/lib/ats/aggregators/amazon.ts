import type { FetchLike } from '../types';
import type { AggregatedPosting, AggregatorClient } from './types';
import { isEarlyCareerTitle } from '../classify';

/**
 * Amazon public jobs JSON connector.
 *
 * amazon.jobs exposes a keyless JSON search endpoint used by its own site:
 *   https://www.amazon.jobs/en/search.json?base_query=intern&result_limit=100&offset=0
 * returning { hits, jobs: [{ title, company_name, city, state, country_code,
 * job_path, id, is_intern, posted_date, ... }] }.
 *
 * The `category[]=student-programs` facet returns 0 for anonymous callers, so we
 * query `base_query=intern` and page through results, then apply the shared
 * strict title gate. Each role's apply URL is the absolute amazon.jobs path.
 *
 * This is a direct employer feed (zero HTML scraping); roles attach to the
 * seeded "Amazon" company by name in the aggregator ingest.
 */

interface AmazonJob {
  id?: string;
  title?: string;
  company_name?: string;
  city?: string;
  state?: string;
  country_code?: string;
  location?: string;
  job_path?: string; // e.g. "/en/jobs/123/software-dev-intern"
  posted_date?: string;
  updated_time?: string;
  is_intern?: boolean;
}
interface AmazonResponse {
  hits?: number;
  jobs?: AmazonJob[];
}

const RESULT_LIMIT = 100;
const MAX_PAGES = 5; // up to 500 intern-matching postings per run

function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = { USA: 'USA', US: 'USA', CAN: 'Canada', GBR: 'UK' };
  return map[code] ?? code;
}

export function createAmazonClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  return {
    source: 'amazon',
    async fetchEarlyCareer(signal) {
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();

      for (let page = 0; page < MAX_PAGES; page++) {
        const url =
          `https://www.amazon.jobs/en/search.json?base_query=intern` +
          `&result_limit=${RESULT_LIMIT}&offset=${page * RESULT_LIMIT}`;
        let res;
        try {
          res = await fetchImpl(url, { signal, headers: { 'User-Agent': 'launchpad-jobs' } });
        } catch {
          break; // network error: stop paging
        }
        if (!res.ok) break;

        let data: AmazonResponse;
        try {
          data = (await res.json()) as AmazonResponse;
        } catch {
          break;
        }
        const jobs = data.jobs ?? [];
        if (jobs.length === 0) break;

        for (const j of jobs) {
          const title = j.title?.trim();
          if (!title || !j.job_path) continue;
          // Strict title gate — base_query=intern also returns adjacent roles.
          if (!isEarlyCareerTitle(title)) continue;

          const externalJobId = `amazon-${j.id ?? j.job_path}`;
          if (seen.has(externalJobId)) continue;
          seen.add(externalJobId);

          const applyUrl = j.job_path.startsWith('http')
            ? j.job_path
            : `https://www.amazon.jobs${j.job_path}`;

          out.push({
            source: 'amazon',
            // Normalize to the canonical seeded company name so roles attach to
            // the official Amazon profile rather than a per-subsidiary legal name.
            companyName: 'Amazon',
            companyWebsite: 'https://www.amazon.com',
            externalJobId,
            title,
            descriptionHtml: '',
            applyUrl,
            city: j.city ?? undefined,
            state: j.state ?? undefined,
            country: countryName(j.country_code),
            employmentTypeRaw: j.is_intern ? 'Intern' : undefined,
            updatedAt: j.updated_time ?? j.posted_date,
          });
        }

        if (jobs.length < RESULT_LIMIT) break;
      }

      return out;
    },
  };
}
