import type { NormalizedPosting } from './types';
import type { Season, FieldType, DegreeLevel, OpportunityType } from '../adapter/types';
import { extractSeasons, cohortYear, roleConcluded, isExpiredTerm } from './seasons';
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

/**
 * Whether a parsed deadline is already in the past relative to `now` (UTC date
 * comparison, Req 7.1). Returns false for absent/unparseable deadlines so we
 * never reject a role for a malformed date.
 */
export function isDeadlinePassed(
  deadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false;
  const today = now.toISOString().slice(0, 10);
  const d = deadline.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < today;
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
    // Req 7.1 — reject roles whose explicit application deadline has passed.
    .filter((p) => !isDeadlinePassed(p.deadline, now))
    // Req 7.2 — reject roles whose title targets an expired past term/year.
    .filter((p) => !isExpiredTerm(p.title, now))
    .filter((p) => isValidHttpUrl(p.applyUrl));
}
