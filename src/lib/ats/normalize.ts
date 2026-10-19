import type { NormalizedPosting } from './types';
import type { Season } from '../adapter/types';
import { extractSeasons, cohortYear, roleConcluded } from './seasons';
import { isEarlyCareer } from './classify';
import { isValidHttpUrl } from './util';

/** A posting enriched with derived season/cohort metadata, ready to upsert. */
export interface EnrichedPosting extends NormalizedPosting {
  seasons: Season[];
  cohortYear: number | null;
}

export function enrich(p: NormalizedPosting): EnrichedPosting {
  const text = `${p.title} ${p.descriptionHtml}`;
  return {
    ...p,
    seasons: extractSeasons(text),
    cohortYear: cohortYear(p.title),
  };
}

/**
 * Full candidate filter for a batch of normalized postings:
 * early-career only, drop concluded cohorts, require a valid HTTP(S) apply URL.
 */
export function selectCandidates(
  postings: NormalizedPosting[],
  now: Date = new Date(),
): EnrichedPosting[] {
  return postings
    .filter(isEarlyCareer)
    .map(enrich)
    .filter((p) => !roleConcluded(p.seasons, p.cohortYear, now))
    .filter((p) => isValidHttpUrl(p.applyUrl));
}
