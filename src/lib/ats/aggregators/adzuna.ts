import type { FetchLike } from '../types';
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

export function createAdzunaClient(
  fetchImpl: FetchLike = fetch,
  env: NodeJS.ProcessEnv = typeof process !== 'undefined' ? process.env : {},
): AggregatorClient & { enabled: boolean } {
  const appId = env.ADZUNA_APP_ID;
  const appKey = env.ADZUNA_API_KEY;
  const enabled = Boolean(appId && appKey);

  return {
    source: 'adzuna',
    enabled,
    async fetchEarlyCareer(signal) {
      if (!enabled) {
        // eslint-disable-next-line no-console
        console.log('Skipping Adzuna sync: ADZUNA_APP_ID / ADZUNA_API_KEY not configured in .env');
        return [];
      }

      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();

      for (const pass of EMPLOYER_PASSES) {
        // `what` requires the intern keyword; `what_phrase` pins the employer name.
        const params = new URLSearchParams({
          app_id: appId!,
          app_key: appKey!,
          results_per_page: '50',
          what: 'intern',
          'content-type': 'application/json',
        });
        if (pass.company) params.set('what_phrase', pass.company);

        const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`;
        let res;
        try {
          res = await fetchImpl(url, { signal });
        } catch {
          continue; // one pass failing shouldn't abort the rest
        }
        if (!res.ok) continue;
        let data: AdzunaResponse;
        try {
          data = (await res.json()) as AdzunaResponse;
        } catch {
          continue;
        }

        for (const j of data.results ?? []) {
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
      }
      return out;
    },
  };
}
