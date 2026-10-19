import type { NormalizedPosting } from './types';

// Req 18.1 — early-career inclusion.
export const EARLY_CAREER_RE =
  /\b(intern|internship|co-?op|fellow|apprentice|new ?grad|early career|university grad|campus|entry[ -]?level)\b/i;

// Req 18.2 — senior/mid-level exclusion (exclusion wins).
export const SENIOR_RE = /\b(senior|staff|principal|director|manager|lead|sr\.?)\b/i;

/**
 * Decide whether a normalized posting is an early-career opportunity.
 * The senior-exclusion check runs first so "Senior Intern" style titles drop out.
 */
export function isEarlyCareer(p: Pick<NormalizedPosting, 'title' | 'employmentTypeRaw'>): boolean {
  if (SENIOR_RE.test(p.title)) return false;
  if (p.employmentTypeRaw && p.employmentTypeRaw.trim().toLowerCase() === 'intern') return true;
  return EARLY_CAREER_RE.test(p.title) || EARLY_CAREER_RE.test(p.employmentTypeRaw ?? '');
}
