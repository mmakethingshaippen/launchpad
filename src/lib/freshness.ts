/**
 * Public freshness policy: a job is publicly listed only when it was
 * successfully verified within the last VERIFICATION_FRESHNESS_DAYS.
 *
 * The database enforces this in the public_roles view
 * (supabase/migrations/0009_public_roles_freshness.sql). This module mirrors
 * the same rule for the LocalAdapter and for the job-detail page, which reads
 * the base table so it can explain why a listing is not shown.
 *
 * Only last_verified_at counts. created_at and failed or blocked attempt
 * timestamps (last_verification_attempt_at, last_verification_failure_at) never
 * extend visibility. A NULL last_verified_at is hidden until a real
 * verification succeeds. Hiding never closes, deletes or re-dates a job.
 */
export const VERIFICATION_FRESHNESS_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Jobs verified at or after this instant are publicly visible. */
export function freshnessCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - VERIFICATION_FRESHNESS_DAYS * DAY_MS);
}

/** True when the last successful verification is recent enough to list publicly. */
export function isFreshlyVerified(lastVerifiedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastVerifiedAt) return false;
  const at = Date.parse(lastVerifiedAt);
  if (Number.isNaN(at)) return false;
  return at >= freshnessCutoff(now).getTime();
}

/**
 * An Active job hidden only because it is awaiting verification. Closed jobs
 * are not "awaiting verification": they keep their existing closed handling.
 */
export function isAwaitingVerification(
  role: { listingStatus: string; lastVerifiedAt: string | null },
  now: Date = new Date(),
): boolean {
  return role.listingStatus === 'Active' && !isFreshlyVerified(role.lastVerifiedAt, now);
}

export const FRESHNESS_NOTE = 'Listings awaiting verification are temporarily hidden.';
export const AWAITING_VERIFICATION_MESSAGE = 'This listing is temporarily unavailable while we verify it';