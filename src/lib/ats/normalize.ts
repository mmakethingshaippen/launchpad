import type { NormalizedPosting } from './types';
import type { Season, FieldType, DegreeLevel, OpportunityType } from '../adapter/types';
import { extractSeasons, cohortYear, roleConcluded } from './seasons';
import {
  isEarlyCareer,
  classifyField,
  classifyOpportunityType,
  classifyDegreeLevels,
} from './classify';
import { isValidHttpUrl } from './util';

/** A posting enriched with derived season/cohort/classification metadata. */
export interface EnrichedPosting extends NormalizedPosting {
  seasons: Season[];
  cohortYear: number | null;
  field: FieldType;
  opportunityType: OpportunityType;
  degreeLevels: DegreeLevel[];
}

export function enrich(p: NormalizedPosting): EnrichedPosting {
  const text = `${p.title} ${p.descriptionHtml}`;
  const opportunityType = classifyOpportunityType(p.title, p.employmentTypeRaw);
  return {
    ...p,
    seasons: extractSeasons(text),
    cohortYear: cohortYear(p.title),
    // Company fallback field is applied later in the sink (it has company context).
    field: classifyField(p.title, undefined, p.employmentTypeRaw),
    opportunityType,
    degreeLevels: classifyDegreeLevels(p.title, opportunityType, p.descriptionHtml),
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
