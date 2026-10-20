import type { FetchLike } from './types';
import type { AggregatedPosting, AggregatorClient } from './aggregators/types';
import { isEarlyCareer } from './classify';
import { splitLocation } from './util';

/**
 * SimplifyJobs GitHub connector.
 *
 * SimplifyJobs publishes curated, community-maintained internship and new-grad
 * listings as a single structured JSON file per repo. We consume the public,
 * raw JSON only — there is zero HTML scraping. The authoritative file lives on
 * the `dev` branch (`main` returns 404 for the scripts path).
 *
 *   raw.githubusercontent.com/SimplifyJobs/<repo>/dev/.github/scripts/listings.json
 *
 * Each listing carries its own `url` (the employer's live apply page) and
 * `company_name`, so this behaves like the other aggregator feeds: companies
 * are matched/created by name and roles attach to them.
 *
 * We only surface rows that are BOTH `active === true` and `is_visible !== false`
 * — SimplifyJobs flips `active` to false the moment a posting closes, which is
 * exactly the "zero expired listings" signal the product requires. Nothing is
 * fabricated; unknown fields stay unknown.
 */

const SIMPLIFY_REPOS = [
  'Summer2026-Internships',
  'Summer2027-Internships',
  'New-Grad-Positions',
] as const;

function listingsUrl(repo: string): string {
  return `https://raw.githubusercontent.com/SimplifyJobs/${repo}/dev/.github/scripts/listings.json`;
}

/** Raw shape of a SimplifyJobs `listings.json` entry (fields we rely on). */
interface SimplifyListing {
  id?: string;
  company_name?: string;
  company_url?: string;
  title?: string;
  url?: string; // employer apply page
  active?: boolean;
  is_visible?: boolean;
  locations?: string[];
  terms?: string[]; // e.g. ["Summer 2026"] — absent on New-Grad feed
  category?: string;
  date_posted?: number; // unix seconds
  date_updated?: number;
}

/** "San Jose, CA" | "Remote in USA" | "Multiple Locations" → parts + remote flag. */
function parseSimplifyLocation(locations: string[] | undefined): {
  city?: string;
  state?: string;
  country?: string;
  remote: boolean;
} {
  const first = (locations ?? []).find((l) => typeof l === 'string' && l.trim());
  if (!first) return { remote: false };
  if (/\bremote\b/i.test(first)) return { remote: true };
  const loc = splitLocation(first);
  return { ...loc, remote: false };
}

export function createSimplifyClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  return {
    source: 'simplify',
    async fetchEarlyCareer(signal) {
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>(); // dedup by external id across repos

      for (const repo of SIMPLIFY_REPOS) {
        let res;
        try {
          res = await fetchImpl(listingsUrl(repo), { signal });
        } catch {
          continue; // network error on this repo: try the next one
        }
        if (!res.ok) continue;

        let listings: SimplifyListing[];
        try {
          listings = (await res.json()) as SimplifyListing[];
        } catch {
          continue;
        }
        if (!Array.isArray(listings)) continue;

        for (const j of listings) {
          // Open + visible only. This is the product's primary open/closed signal.
          if (j.active !== true) continue;
          if (j.is_visible === false) continue;

          const companyName = j.company_name?.trim();
          const title = j.title?.trim();
          const applyUrl = j.url?.trim();
          if (!companyName || !title || !applyUrl) continue;

          // Early-career guard (exclusion wins). The New-Grad repo is early-career
          // by definition, but keep the shared classifier as a safety net so stray
          // senior titles are dropped.
          const employmentTypeRaw = repo === 'New-Grad-Positions' ? 'New Grad' : 'Intern';
          if (!isEarlyCareer({ title, employmentTypeRaw })) continue;

          const externalJobId = `simplify-${j.id ?? applyUrl}`;
          if (seen.has(externalJobId)) continue;
          seen.add(externalJobId);

          const { city, state, country, remote } = parseSimplifyLocation(j.locations);
          const terms = (j.terms ?? []).join(' '); // feeds season extraction via title+desc

          out.push({
            source: 'simplify',
            companyName,
            companyWebsite: j.company_url,
            externalJobId,
            // Append terms to the title so the shared season extractor can read
            // "Summer 2026" even though there's no description body.
            title: terms ? `${title} (${terms})` : title,
            descriptionHtml: '',
            applyUrl,
            city,
            state,
            country,
            workArrangement: remote ? 'Remote' : undefined,
            employmentTypeRaw,
            updatedAt: j.date_updated ? new Date(j.date_updated * 1000).toISOString() : undefined,
          });
        }
      }

      return out;
    },
  };
}
