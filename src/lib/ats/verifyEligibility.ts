/**
 * Server-side only. Whether an Active role may receive a fresh last_verified_at.
 *
 * Uses the same rules ingestion and ATS sync apply before accepting a posting
 * (roleConcluded, isDeadlinePassed, isExpiredTerm), so "verified" never
 * contradicts "eligible". A live page does not make a concluded listing current.
 *
 * Classification conflict: ingestion leaves such rows Active and untouched
 * (it never closes from this evidence), and public_roles only hides rows whose
 * deadline passed, not concluded terms. Verification follows ingestion: it does
 * not stamp them and does not close them. They are reported as ineligible so
 * the conflict stays visible instead of being hidden by a fresh date.
 */
import type { Season } from '../adapter/types';
import { roleConcluded, isExpiredTerm } from './seasons';
import { isDeadlinePassed } from './normalize';

export interface EligibilityFields {
  title?: string | null;
  seasons?: unknown;
  cohort_year?: unknown;
  application_deadline?: string | null;
}

export const ELIGIBILITY_COLUMNS = 'title,seasons,cohort_year,application_deadline';

/** Null when the role may be verified; otherwise why it must not be. */
export function verificationBlocker(row: EligibilityFields, now: Date): string | null {
  const seasons = Array.isArray(row.seasons) ? (row.seasons as Season[]) : [];
  const year = typeof row.cohort_year === 'number' ? row.cohort_year : null;
  if (roleConcluded(seasons, year, now)) return 'cohort-concluded';
  if (isDeadlinePassed(row.application_deadline ?? null, now)) return 'deadline-passed';
  if (row.title && isExpiredTerm(row.title, now)) return 'expired-term-in-title';
  return null;
}