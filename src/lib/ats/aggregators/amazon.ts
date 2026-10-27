import type { FetchLike } from '../types';
import { fetchRetrying, TRANSIENT_HTTP } from '../fetchRetry';
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
 * query `base_query=intern` and page through every result, then apply the shared
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
/** Safety stop only. Paging ends earlier when Amazon returns a short page. */
const MAX_PAGES = 100;

function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = { USA: 'USA', US: 'USA', CAN: 'Canada', GBR: 'UK' };
  return map[code] ?? code;
}

export function createAmazonClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  let feedComplete = false;
  return {
    source: 'amazon',
    feedWasComplete: () => feedComplete,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      let stoppedEarly = false;
      let skippedPages = 0;
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();
      let previousFirstId: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * RESULT_LIMIT;
        const url =
          `https://www.amazon.jobs/en/search.json?base_query=intern` +
          `&result_limit=${RESULT_LIMIT}&offset=${offset}`;
        let res;
        try {
          res = await fetchRetrying(
            fetchImpl,
            url,
            { signal, headers: { 'User-Agent': 'launchpad-jobs' } },
            `Amazon offset ${offset}`,
          );
        } catch {
          stoppedEarly = true;
          skippedPages += 1;
          if (skippedPages >= 3) break;
          continue;
        }
        if (!res.ok) {
          stoppedEarly = true;
          if (!TRANSIENT_HTTP.has(res.status) || skippedPages >= 2) {
            console.error(`Amazon: stopped at offset ${offset}: HTTP ${res.status}`);
            break;
          }
          skippedPages += 1;
          console.error(`Amazon: HTTP ${res.status} at offset ${offset}; skipping that page`);
          continue;
        }
        skippedPages = 0;

        let data: AmazonResponse;
        try {
          data = (await res.json()) as AmazonResponse;
        } catch {
          stoppedEarly = true;
          skippedPages += 1;
          if (skippedPages >= 3) break;
          continue;
        }
        const jobs = data.jobs ?? [];
        if (jobs.length === 0) break;
        const firstId = jobs[0]?.id ?? jobs[0]?.job_path;
        if (firstId && firstId === previousFirstId) break;
        previousFirstId = firstId;

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

        const hits = typeof data.hits === 'number' ? data.hits : undefined;
        if (jobs.length < RESULT_LIMIT) break;
        if (hits !== undefined && offset + jobs.length >= hits) break;
        if (page === MAX_PAGES - 1) {
          console.error(`Amazon: safety stop at ${MAX_PAGES} pages; more results may remain`);
          stoppedEarly = true;
        }
      }

      feedComplete = !stoppedEarly;
      return out;
    },
  };
}
