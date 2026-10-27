import type { FetchLike } from '../types';
import { fetchRetrying, TRANSIENT_HTTP } from '../fetchRetry';
import type { AggregatedPosting, AggregatorClient } from './types';
import { isEarlyCareerTitle } from '../classify';

// Adzuna public jobs search API (requires app_id + app_key):
//   https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=..&app_key=..&what=intern
interface AdzunaJob {
  id?: string;
  title?: string;
  redirect_url?: string;
  description?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
  created?: string;
  contract_type?: string;
}
interface AdzunaResponse {
  count?: number;
  results?: AdzunaJob[];
}

/** Parse "City, State" style Adzuna location into our fields. */
function parseLocation(loc: AdzunaJob['location']): { city?: string; state?: string; country?: string } {
  const name = loc?.display_name;
  if (!name) return {};
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1) return { city: parts[0] };
  if (parts.length === 2) return { city: parts[0], state: parts[1] };
  return { city: parts[0], state: parts[1], country: parts.slice(2).join(', ') };
}

/**
 * Targeted employer passes. Each pass queries internships at a specific major
 * employer (`what_phrase` for the company + `what=intern`), and rewrites the
 * returned company name to our canonical seeded name so the roles attach to the
 * official company profile. A final broad `what=intern` pass catches everything
 * else.
 */
interface AdzunaPass {
  /** Keyword query (joined with "intern"). */
  company?: string;
  /** Canonical company name to stamp on matched results (seeded profile). */
  canonicalName?: string;
  canonicalWebsite?: string;
}

const EMPLOYER_PASSES: AdzunaPass[] = [
  { company: 'Google', canonicalName: 'Google', canonicalWebsite: 'https://www.google.com' },
  { company: 'Amazon', canonicalName: 'Amazon', canonicalWebsite: 'https://www.amazon.com' },
  { company: 'Tesla', canonicalName: 'Tesla', canonicalWebsite: 'https://www.tesla.com' },
  {
    company: 'Kaiser Permanente',
    canonicalName: 'Kaiser Permanente',
    canonicalWebsite: 'https://www.kaiserpermanente.org',
  },
  {
    company: 'Sutter Health',
    canonicalName: 'Sutter Health',
    canonicalWebsite: 'https://www.sutterhealth.org',
  },
  {}, // broad internship pass
];

const PAGE_SIZE = 50;
/** Safety stop only. Each search ends earlier when Adzuna returns a short page. */
const MAX_PAGES = 20;

export function createAdzunaClient(
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = typeof process !== 'undefined' ? process.env : {},
): AggregatorClient & { enabled: boolean } {
  const appId = env.ADZUNA_APP_ID;
  const appKey = env.ADZUNA_API_KEY;
  const enabled = Boolean(appId && appKey);

  let feedComplete = false;
  return {
    source: 'adzuna',
    enabled,
    feedWasComplete: () => feedComplete,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      if (!enabled) {
        // eslint-disable-next-line no-console
        console.log('Skipping Adzuna sync: ADZUNA_APP_ID / ADZUNA_API_KEY not configured in .env');
        return [];
      }

      let stoppedEarly = false;
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();

      for (const pass of EMPLOYER_PASSES) {
        const label = pass.company ?? 'broad';
        let previousFirstId: string | undefined;
        let skippedPages = 0;
        for (let page = 1; page <= MAX_PAGES; page++) {
          // `what` requires the intern keyword; `what_phrase` pins the employer name.
          const params = new URLSearchParams({
            app_id: appId!,
            app_key: appKey!,
            results_per_page: String(PAGE_SIZE),
            what: 'intern',
            'content-type': 'application/json',
          });
          if (pass.company) params.set('what_phrase', pass.company);

          const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params.toString()}`;
          let res;
          try {
            res = await fetchRetrying(fetchImpl, url, { signal }, `Adzuna ${label} page ${page}`);
          } catch {
            stoppedEarly = true;
            skippedPages += 1;
            if (skippedPages >= 3) break;
            continue;
          }
          if (!res.ok) {
            stoppedEarly = true;
            if (!TRANSIENT_HTTP.has(res.status) || skippedPages >= 2) {
              console.error(`Adzuna: stopped on ${label} page ${page}: HTTP ${res.status}`);
              break;
            }
            skippedPages += 1;
            console.error(`Adzuna: HTTP ${res.status} on ${label} page ${page}; skipping that page`);
            continue;
          }
          skippedPages = 0;
          let data: AdzunaResponse;
          try {
            data = (await res.json()) as AdzunaResponse;
          } catch {
            stoppedEarly = true;
            skippedPages += 1;
            if (skippedPages >= 3) break;
            continue;
          }

          const results = data.results ?? [];
          if (results.length === 0) break;
          const firstId = results[0]?.id ?? results[0]?.redirect_url;
          if (firstId && firstId === previousFirstId) break;
          previousFirstId = firstId;

          for (const j of results) {
            if (!j.title || !j.company?.display_name || !j.redirect_url) continue;
            // Strict title-level early-career gate (A1 seniority + A2 recruiter + B).
            if (!isEarlyCareerTitle(j.title)) continue;

            // For a targeted employer pass, only keep rows whose company actually
            // matches, then rewrite to our canonical seeded name.
            let companyName = j.company.display_name;
            let companyWebsite: string | undefined;
            if (pass.company) {
              const re = new RegExp(pass.company.replace(/\s+/g, '.*'), 'i');
              if (!re.test(j.company.display_name)) continue;
              companyName = pass.canonicalName ?? companyName;
              companyWebsite = pass.canonicalWebsite;
            }

            // Dedup only after we've decided to keep the role, so an employer pass
            // that skips a non-matching company doesn't suppress the broad pass.
            const externalJobId = `adzuna-${j.id ?? j.redirect_url}`;
            if (seen.has(externalJobId)) continue;
            seen.add(externalJobId);

            out.push({
              source: 'adzuna',
              companyName,
              companyWebsite,
              externalJobId,
              title: j.title,
              descriptionHtml: j.description ?? '',
              applyUrl: j.redirect_url,
              ...parseLocation(j.location),
              employmentTypeRaw: j.contract_type,
              updatedAt: j.created,
            });
          }

          const count = typeof data.count === 'number' ? data.count : undefined;
          if (results.length < PAGE_SIZE) break;
          if (count !== undefined && page * PAGE_SIZE >= count) break;
          if (page === MAX_PAGES) {
            console.error(`Adzuna: safety stop on ${label} at ${MAX_PAGES} pages; more results may remain`);
            stoppedEarly = true;
          }
        }
      }
      feedComplete = !stoppedEarly;
      return out;
    },
  };
}
