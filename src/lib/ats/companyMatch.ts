/**
 * Map a raw company name from an aggregator feed to the slug of a seeded,
 * official company profile — so roles from SimplifyJobs / Amazon / Adzuna attach
 * to the real company page and map pin instead of spawning a near-duplicate
 * ("Amazon.com Services LLC", "Google LLC", etc.).
 *
 * The approach: aggressively normalize the name (lowercase, drop legal suffixes
 * and punctuation), then consult an explicit alias table for the big employers
 * we seed. If no alias matches, fall back to the generic slugify so unseeded
 * companies still group cleanly by their own name.
 */

/** Legal-entity suffixes and noise words stripped before matching. */
const LEGAL_SUFFIX_RE =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|com|company|plc|gmbh|sa|s\.a|ag|nv|lp|llp|holdings|group|services|technologies|technology|labs|systems|usa|us|america|north america|global|worldwide)\b/g;

/** Canonical name → slug for employers we maintain official seeded profiles for. */
const CANONICAL_SLUG: Record<string, string> = {
  google: 'google',
  alphabet: 'google',
  'google cloud': 'google',
  youtube: 'google',
  amazon: 'amazon',
  'amazon web': 'amazon', // "Amazon Web Services" → amazon-web after suffix strip
  aws: 'amazon',
  'amazon web services': 'amazon',
  tesla: 'tesla',
  spacex: 'spacex',
  'space exploration': 'spacex', // "Space Exploration Technologies" → spacex
  'kaiser permanente': 'kaiser-permanente',
  kaiser: 'kaiser-permanente',
  'sutter health': 'sutter-health',
  sutter: 'sutter-health',
  // ── State government portals (profiles seeded; roles arrive via structured
  //    channels like USAJOBS / Adzuna / SimplifyJobs and attach here) ──
  'state of california': 'state-of-california',
  'california department': 'state-of-california',
  calcareers: 'state-of-california',
  'california state': 'state-of-california',
  'state of new york': 'new-york-state',
  'new york state': 'new-york-state',
  'state of texas': 'state-of-texas',
  'texas state': 'state-of-texas',
  'state of washington': 'state-of-washington',
  'washington state': 'state-of-washington',
};

/**
 * Employers restricted to Internship / Co-op listings only (Req 6). Any
 * Entry-level / New-grad or full-time posting for these companies is dropped at
 * ingest / sync time and by the live cleanup pass.
 */
export const INTERNSHIP_ONLY_SLUGS = new Set<string>(['google', 'amazon', 'tesla', 'spacex']);

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,/#!$%^*;:{}=\-_`~()]/g, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Resolve a raw aggregator company name to a canonical seeded slug when it is
 * one of our tracked major employers; otherwise return the generic slug.
 */
export function canonicalCompanySlug(rawName: string): string {
  const normalized = normalizeCompanyName(rawName);
  if (!normalized) return slugifyCompany(rawName);

  // Exact normalized match first.
  if (CANONICAL_SLUG[normalized]) return CANONICAL_SLUG[normalized];

  // Prefix match: "google cloud platform" → google, "amazon dev center" → amazon.
  for (const [alias, slug] of Object.entries(CANONICAL_SLUG)) {
    if (normalized === alias || normalized.startsWith(alias + ' ')) return slug;
  }

  return slugifyCompany(rawName);
}
