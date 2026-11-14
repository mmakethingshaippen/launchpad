/**
 * Server-side only. Recognise an explicit bot/access challenge from a response.
 *
 * Only positive vendor evidence counts. A plain 403 is NOT a challenge: it can
 * be a per-URL permission error, a geo rule, or a transient edge decision, and
 * it keeps its ordinary failure handling and retry schedule.
 *
 * A challenge is never evidence that a listing is open or closed. Callers must
 * leave last_verified_at and listing_status unchanged and only reschedule.
 *
 * Detection is for reporting and backoff. Nothing here tries to solve,
 * evade or work around a challenge.
 */

export interface HeaderSource {
  get(name: string): string | null;
}

export interface AccessChallenge {
  vendor: 'cloudflare' | 'aws-waf' | 'akamai';
  /** Short, log-safe description of what was observed. */
  evidence: string;
}

const CF_CHALLENGE_BODY_RE = /<title>\s*Just a moment\.\.\.\s*<\/title>|\/cdn-cgi\/challenge-platform\/|cf-chl-|cf_chl_opt/i;
const AKAMAI_BODY_RE = /<title>\s*Access Denied\s*<\/title>[\s\S]{0,2000}errors\.edgesuite\.net/i;

export function detectAccessChallenge(
  status: number,
  headers: HeaderSource | null | undefined,
  body = '',
): AccessChallenge | null {
  const header = (name: string) => (headers?.get(name) ?? '').toLowerCase();

  // Cloudflare sets this header only when it served a challenge instead of the origin response.
  if (header('cf-mitigated') === 'challenge') {
    return { vendor: 'cloudflare', evidence: `cf-mitigated=challenge (HTTP ${status})` };
  }
  const waf = header('x-amzn-waf-action');
  if (waf === 'challenge' || waf === 'captcha') {
    return { vendor: 'aws-waf', evidence: `x-amzn-waf-action=${waf} (HTTP ${status})` };
  }
  // Body markers count only on a refusal status, so a normal page that mentions them cannot match.
  if (status === 403 || status === 429 || status === 503) {
    if (header('server').includes('cloudflare') && CF_CHALLENGE_BODY_RE.test(body)) {
      return { vendor: 'cloudflare', evidence: `Cloudflare challenge page (HTTP ${status})` };
    }
    if (status === 403 && header('server').includes('akamai') && AKAMAI_BODY_RE.test(body)) {
      return { vendor: 'akamai', evidence: `Akamai access denied page (HTTP ${status})` };
    }
  }
  return null;
}

/** Stored failure reason for a challenged attempt. Rows are recognised by this prefix. */
export const BLOCKED_REASON_PREFIX = 'blocked:';

export function blockedReason(challenge: AccessChallenge): string {
  return `${BLOCKED_REASON_PREFIX}${challenge.vendor}-challenge`;
}

export function isBlockedReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.startsWith(BLOCKED_REASON_PREFIX);
}