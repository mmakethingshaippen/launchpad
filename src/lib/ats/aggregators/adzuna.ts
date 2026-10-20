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
      const url =
        `https://api.adzuna.com/v1/api/jobs/us/search/1` +
        `?app_id=${encodeURIComponent(appId!)}&app_key=${encodeURIComponent(appKey!)}` +
        `&results_per_page=50&what=intern&content-type=application/json`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`Adzuna: HTTP ${res.status}`);
      const data = (await res.json()) as AdzunaResponse;

      const out: AggregatedPosting[] = [];
      for (const j of data.results ?? []) {
        if (!j.title || !j.company?.display_name || !j.redirect_url) continue;
        // Strict title-level early-career gate (A1 seniority + A2 recruiter + B).
        if (!isEarlyCareerTitle(j.title)) continue;
        out.push({
          source: 'adzuna',
          companyName: j.company.display_name,
          externalJobId: `adzuna-${j.id ?? j.redirect_url}`,
          title: j.title,
          descriptionHtml: j.description ?? '',
          applyUrl: j.redirect_url,
          ...parseLocation(j.location),
          employmentTypeRaw: j.contract_type,
          updatedAt: j.created,
        });
      }
      return out;
    },
  };
}
