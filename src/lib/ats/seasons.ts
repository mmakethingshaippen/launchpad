import type { Season, SpecificSeason } from '../adapter/types';

/**
 * Extract season tags from free text (title + description).
 * Returns all matched specific seasons; if none match, ['Year-Round'] (Req 18.3-18.5).
 */
export function extractSeasons(text: string): Season[] {
  const t = text.toLowerCase();
  const hits: Season[] = [];
  if (/\b(fall|autumn)\b/.test(t)) hits.push('Fall');
  if (/\bwinter\b/.test(t)) hits.push('Winter');
  if (/\bspring\b/.test(t)) hits.push('Spring');
  if (/\bsummer\b/.test(t)) hits.push('Summer');
  return hits.length ? Array.from(new Set(hits)) : ['Year-Round'];
}

/**
 * Parse a 4-digit cohort year (2024-2099) from text, if present.
 * Returns the first plausible year found, else null.
 */
export function cohortYear(text: string): number | null {
  const m = text.match(/\b(20[2-9]\d)\b/);
  return m ? Number(m[1]) : null;
}

// Locked cutoff dates (end of the cohort occurrence) — refinement #3: UTC.
const CUTOFF: Record<SpecificSeason, (y: number) => Date> = {
  Winter: (y) => new Date(Date.UTC(y, 2, 31, 23, 59, 59)), // Mar 31
  Spring: (y) => new Date(Date.UTC(y, 4, 31, 23, 59, 59)), // May 31
  Summer: (y) => new Date(Date.UTC(y, 7, 31, 23, 59, 59)), // Aug 31
  Fall: (y) => new Date(Date.UTC(y, 11, 15, 23, 59, 59)), // Dec 15
};

function isSpecific(season: Season): season is SpecificSeason {
  return season !== 'Year-Round';
}

/**
 * The year of the next upcoming occurrence of a season relative to `now`.
 * If this year's cutoff is still ahead, use this year; otherwise next year.
 */
export function nextOccurrenceYear(season: Season, now: Date = new Date()): number {
  if (!isSpecific(season)) return now.getUTCFullYear();
  const thisYear = now.getUTCFullYear();
  return now.getTime() <= CUTOFF[season](thisYear).getTime() ? thisYear : thisYear + 1;
}

/**
 * Whether a (season, cohortYear) has already concluded relative to `now` (Req 19.1, decision #4).
 * - Year-Round never concludes.
 * - A stated cohort year earlier than the current UTC year is concluded immediately.
 * - With no stated year, assume the next upcoming occurrence (so live postings aren't falsely rejected).
 */
export function isConcluded(
  season: Season,
  year: number | null,
  now: Date = new Date(),
): boolean {
  if (!isSpecific(season)) return false;
  if (year !== null && year < now.getUTCFullYear()) return true;
  const effectiveYear = year ?? nextOccurrenceYear(season, now);
  return now.getTime() > CUTOFF[season](effectiveYear).getTime();
}

/**
 * Given a role's seasons + cohort year, is the whole role concluded?
 * A role is concluded only if ALL of its specific seasons have concluded.
 * (A Year-Round tag keeps it alive.)
 */
export function roleConcluded(
  seasons: Season[],
  year: number | null,
  now: Date = new Date(),
): boolean {
  if (seasons.includes('Year-Round')) return false;
  const specific = seasons.filter(isSpecific);
  if (specific.length === 0) return false;
  return specific.every((s) => isConcluded(s, year, now));
}
