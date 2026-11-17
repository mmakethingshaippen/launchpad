import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidHttpUrl } from '../util';
import { judgePage, type PageVerdictKind } from './pageEvidence';
import { verificationBlocker } from '../verifyEligibility';
import { isBlockedReason } from '../accessChallenge';
import { checkHimalayasJob, himalayasJobUrl } from './himalayas';

export { judgePage } from './pageEvidence';

/**
 * Server-side only. Fallback verification for aggregator roles that no feed
 * observed recently. Each eligible role gets one look at its own apply page.
 *
 * Truthfulness rules:
 *  - last_verified_at changes only when the page carries evidence for that role.
 *  - Every attempt is recorded separately (last_verification_attempt_at, and
 *    failure columns for unverified outcomes). A failed attempt never touches
 *    last_verified_at and never manufactures a fresh date.
 *  - Closing needs an explicit 404/410 attributable to the original URL.
 *    Timeouts, 403/429/5xx, unreadable pages and generic redirects leave the row
 *    open and unverified with a retry time.
 *  - An explicit access challenge (Cloudflare, AWS WAF, Akamai) is 'blocked':
 *    counted separately, never treated as open or closed, and backed off for
 *    longer. A plain 403 without challenge evidence stays an ordinary failure.
 *
 * Request volume against a blocking host is limited two ways:
 *  - Within a run, after HOST_BLOCK_THRESHOLD consecutive challenges from one
 *    host, its remaining roles are skipped (not attempted, not written).
 *  - Across runs, challenged roles wait BLOCKED_BACKOFF_HOURS. When every due
 *    role of a host is waiting, up to RECOVERY_PROBES_PER_HOST of them are still
 *    tried as recovery probes. If a probe gets past the challenge, that host's
 *    waiting blocked roles are rescheduled for the next run.
 */

/**
 * Daily cohort. A role is due when it has not been verified since the start of
 * the current UTC day of this run, so a run that starts 10 hours earlier than
 * yesterday's still covers everything yesterday's run stamped. A fixed
 * "older than N hours" cutoff cannot do that: the GitHub schedule drifted by up
 * to ~10 hours between consecutive runs.
 *
 * The minimum gap only avoids re-fetching what a run stamped moments ago when
 * two runs straddle midnight UTC.
 */
export const VERIFICATION_MIN_GAP_HOURS = 12;
/** Retry delays after consecutive ordinary unverified attempts (timeouts, plain 403, 5xx, unreadable). */
export const RETRY_BACKOFF_HOURS = [2, 6, 12];
/** Retry delays after consecutive unverified attempts whose latest result was an explicit access challenge. */
export const BLOCKED_BACKOFF_HOURS = [24, 72, 168];
/** Consecutive challenges from one host, within a run, before its remaining roles are skipped. */
export const HOST_BLOCK_THRESHOLD = 3;
/** Waiting blocked roles tried per host per run when nothing else from that host is due. */
export const RECOVERY_PROBES_PER_HOST = 3;

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 600_000;
/** Refusal bodies are read only far enough to recognise a challenge page. */
const MAX_REFUSAL_BODY_CHARS = 20_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_BUDGET_MS = 45 * 60 * 1000;
const MAX_REASON_CHARS = 200;
const WRITE_BATCH = 100;

/** Start of the UTC day containing `now`. */
export function cohortStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Roles verified before this instant, or never, are due today. */
export function verificationCutoff(now: Date): Date {
  const gapLimit = now.getTime() - VERIFICATION_MIN_GAP_HOURS * HOUR_MS;
  return new Date(Math.min(cohortStart(now).getTime(), gapLimit));
}

function backoff(now: Date, failureCount: number, schedule: number[]): Date {
  const index = Math.min(Math.max(failureCount, 1), schedule.length) - 1;
  return new Date(now.getTime() + schedule[index] * HOUR_MS);
}

/** When an unverified role may be tried again, given its consecutive failure count (1-based). */
export function nextRetryAt(now: Date, failureCount: number): Date {
  return backoff(now, failureCount, RETRY_BACKOFF_HOURS);
}

/** Retry time after an explicit access challenge, given the consecutive failure count (1-based). */
export function nextBlockedRetryAt(now: Date, failureCount: number): Date {
  return backoff(now, failureCount, BLOCKED_BACKOFF_HOURS);
}

export interface PaginationReport {
  pages: number;
  complete: boolean;
  /** Why paging ended. Anything other than an empty final page makes the scan incomplete. */
  stopReason: string;
}

/** Per feed (external_job_id prefix) and destination host. */
export interface SourceBreakdown {
  feed: string;
  host: string;
  /** Due roles of this feed/host, including those waiting on a retry time. */
  due: number;
  waitingAtStart: number;
  attempted: number;
  verified: number;
  closed: number;
  unreadable: number;
  failed: number;
  blocked: number;
  /** Not attempted because this host kept serving challenges earlier in the run. */
  hostBlockedSkipped: number;
  deferred: number;
}

export interface StaleSweepResult {
  /** Active aggregator roles due for verification and not waiting on a retry time. */
  eligible: number;
  /** Same as retryWaitingAtStart. Kept for existing callers. */
  waitingRetry: number;
  /** Due roles whose next_verification_at was still in the future when the run started. */
  retryWaitingAtStart: number;
  /** Due roles with a future next_verification_at when the run ended (still waiting plus newly scheduled). */
  retryScheduledAtEnd: number;
  /**
   * Due roles the pipeline's own rules treat as concluded or expired. They are
   * not fetched, not stamped and not closed (see verifyEligibility.ts).
   */
  ineligible: number;
  /** Requests made, including recovery probes. */
  attempted: number;
  /** Role-specific evidence found AND recorded. */
  verified: number;
  /** Explicit 404/410 on the original URL, recorded. */
  closed: number;
  /** Page reached but no evidence for this role (generic page, login, search, unrelated posting...). */
  unreadable: number;
  /** Timeouts, plain 403, 429, 5xx, network errors, and live/closed results whose write did not land. */
  failed: number;
  /** Explicit access challenges. Not included in failed. */
  blocked: number;
  /** Ready roles not attempted because their host kept serving challenges earlier in this run. */
  hostBlockedSkipped: number;
  /** Waiting blocked roles tried anyway to see whether their host stopped challenging. */
  recoveryProbes: number;
  /** Hosts that served at least HOST_BLOCK_THRESHOLD consecutive challenges this run. */
  blockedHosts: string[];
  /** Hosts with earlier challenged roles that answered without a challenge this run. */
  recoveredHosts: string[];
  /** Waiting blocked roles of recovered hosts whose retry time was cleared for the next run. */
  retryCleared: number;
  /** Eligible roles not attempted before the time budget ended. They stay first in line next run. */
  deferred: number;
  /** Database writes that failed or matched no row. Also counted in failed (or the attempt's own category). */
  writeFailures: number;
  /** Due roles (including waiting ones) still neither verified nor closed after this run. */
  backlog: number;
  bySource: SourceBreakdown[];
  pagination: PaginationReport;
  /** True when the due list was read completely and every ready role was attempted. */
  cycleComplete: boolean;
  summaryPersisted: boolean;
}

type EligibleRole = {
  id: string;
  title: string;
  applyUrl: string;
  sourceUrl: string | null;
  companyName: string | null;
  /** external_job_id prefix, e.g. 'muse'. */
  feed: string;
  host: string;
  lastVerifiedAt: string | null;
  lastAttemptAt: string | null;
  lastFailureReason: string | null;
  failureCount: number;
  nextVerificationAt: string | null;
  /** Why this role must not receive a fresh last_verified_at, if anything. */
  blocker: string | null;
};

type Outcome = { kind: PageVerdictKind; reason: string };

const ROLE_COLUMNS =
  'id,title,apply_url,source_url,external_job_id,seasons,cohort_year,application_deadline,last_verified_at,' +
  'last_verification_attempt_at,last_verification_failure_reason,verification_failure_count,next_verification_at,companies(name)';

function companyNameOf(row: Record<string, unknown>): string | null {
  const c = row.companies;
  const one = Array.isArray(c) ? c[0] : c;
  const name = one && typeof one === 'object' ? (one as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? name : null;
}

export function feedOf(externalJobId: unknown): string {
  if (typeof externalJobId !== 'string') return 'unknown';
  const dash = externalJobId.indexOf('-');
  return dash > 0 ? externalJobId.slice(0, dash) : 'unknown';
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'invalid-url';
  }
}

/**
 * Read every eligible page. Only an empty page ends the scan: a database or
 * PostgREST max-rows setting below the requested limit returns short pages that
 * are NOT the last page. Rows with a NULL last_verified_at are included.
 */
export async function loadEligibleRoles(
  db: SupabaseClient,
  cutoff: Date,
  pageSize = DEFAULT_PAGE_SIZE,
  now: Date = new Date(),
): Promise<{ rows: EligibleRole[]; pagination: PaginationReport }> {
  const rows: EligibleRole[] = [];
  const pagination: PaginationReport = { pages: 0, complete: false, stopReason: 'not started' };
  let after = '';
  for (;;) {
    let query = db.from('roles')
      .select(ROLE_COLUMNS)
      .eq('source', 'aggregator')
      .eq('listing_status', 'Active')
      .or(`last_verified_at.is.null,last_verified_at.lt.${cutoff.toISOString()}`)
      .order('id', { ascending: true })
      .limit(pageSize);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) {
      const hint = /does not exist|schema cache/i.test(error.message)
        ? '; apply supabase/migrations/0007_aggregator_verification.sql first'
        : '';
      pagination.stopReason = `database error after ${pagination.pages} page(s): ${error.message}${hint}`;
      return { rows, pagination };
    }
    const page = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
    if (page.length === 0) {
      pagination.complete = true;
      pagination.stopReason = 'empty page reached';
      return { rows, pagination };
    }
    const last = String(page[page.length - 1].id);
    if (last === after) {
      pagination.stopReason = `no cursor progress at page ${pagination.pages + 1}`;
      return { rows, pagination };
    }
    pagination.pages += 1;
    for (const row of page) {
      const applyUrl = typeof row.apply_url === 'string' ? row.apply_url : '';
      rows.push({
        id: String(row.id),
        title: typeof row.title === 'string' ? row.title : '',
        applyUrl,
        sourceUrl: typeof row.source_url === 'string' ? row.source_url : null,
        companyName: companyNameOf(row),
        feed: feedOf(row.external_job_id),
        host: hostOf(applyUrl),
        lastVerifiedAt: typeof row.last_verified_at === 'string' ? row.last_verified_at : null,
        lastAttemptAt: typeof row.last_verification_attempt_at === 'string' ? row.last_verification_attempt_at : null,
        lastFailureReason: typeof row.last_verification_failure_reason === 'string' ? row.last_verification_failure_reason : null,
        failureCount: typeof row.verification_failure_count === 'number' ? row.verification_failure_count : 0,
        nextVerificationAt: typeof row.next_verification_at === 'string' ? row.next_verification_at : null,
        blocker: verificationBlocker({
          title: typeof row.title === 'string' ? row.title : '',
          seasons: row.seasons,
          cohort_year: row.cohort_year,
          application_deadline: typeof row.application_deadline === 'string' ? row.application_deadline : null,
        }, now),
      });
    }
    after = last;
  }
}

/**
 * Fair order: never-attempted first, then least recently attempted, then
 * never-verified, then oldest verification. Rows a budget-limited run did not
 * reach keep their old attempt time, so they lead the next run.
 */
export function orderForVerification(rows: EligibleRole[]): EligibleRole[] {
  const key = (value: string | null) => (value === null ? Number.NEGATIVE_INFINITY : Date.parse(value));
  return [...rows].sort((a, b) =>
    key(a.lastAttemptAt) - key(b.lastAttemptAt) ||
    key(a.lastVerifiedAt) - key(b.lastVerifiedAt) ||
    a.id.localeCompare(b.id));
}

function classifyFetchError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network-error';
}

async function checkRole(
  role: EligibleRole,
  fetchImpl: typeof fetch,
  now: Date,
): Promise<Outcome> {
  if (!isValidHttpUrl(role.applyUrl)) return { kind: 'unreadable', reason: 'invalid-apply-url' };
  if (role.feed === 'himalayas' || himalayasJobUrl(role.applyUrl)) {
    return checkHimalayasJob(role, fetchImpl, now);
  }
  let response: Response;
  try {
    response = await fetchImpl(role.applyUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: 'failed', reason: classifyFetchError(error) };
  }
  let body = '';
  if (response.status >= 200 && response.status < 300) {
    try {
      body = (await response.text()).slice(0, MAX_BODY_CHARS);
    } catch (error) {
      return classifyFetchError(error) === 'timeout'
        ? { kind: 'failed', reason: 'timeout' }
        : { kind: 'unreadable', reason: 'unreadable-body' };
    }
  } else if (response.status === 403 || response.status === 429 || response.status === 503) {
    // Only to tell a challenge page from a plain refusal. An unreadable body just means "no body evidence".
    body = (await response.text().catch(() => '')).slice(0, MAX_REFUSAL_BODY_CHARS);
  }
  const verdict = judgePage({
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body,
    role: { title: role.title, companyName: role.companyName },
    requestedUrl: role.applyUrl,
    finalUrl: response.url || null,
    headers: response.headers,
    now,
  });
  return { kind: verdict.verdict, reason: verdict.reason };
}

function isMissingColumnError(message: string): boolean {
  return /column|does not exist|schema cache/i.test(message);
}

export async function sweepStaleAggregatorRoles(
  db: SupabaseClient,
  opts: {
    fetchImpl?: typeof fetch;
    now?: Date;
    concurrency?: number;
    budgetMs?: number;
    /** Rows requested per database page. The server may return fewer. */
    pageSize?: number;
    /** Monotonic millisecond clock for the time budget. Injectable for tests. */
    clock?: () => number;
    /** Feed coverage from this run's ingestion, stored with the run summary. */
    feeds?: unknown;
    /** Explicit feed challenges from this run. Do not immediately retry that host via job pages. */
    blockedHosts?: ReadonlySet<string>;
    log?: (message: string) => void;
  } = {},
): Promise<StaleSweepResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const runStart = opts.now ?? new Date();
  const log = opts.log ?? (() => undefined);
  const clock = opts.clock ?? Date.now;
  const stampTime = () => opts.now ?? new Date();
  const cutoff = verificationCutoff(runStart);
  const deadline = clock() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);

  const loaded = await loadEligibleRoles(db, cutoff, opts.pageSize ?? DEFAULT_PAGE_SIZE, runStart);
  const ineligibleRows = loaded.rows.filter((r) => r.blocker);
  const due = loaded.rows.filter((r) => !r.blocker);
  const isWaiting = (r: EligibleRole) => Boolean(r.nextVerificationAt) && Date.parse(r.nextVerificationAt!) > runStart.getTime();
  const ready = due.filter((r) => !isWaiting(r));
  const waiting = due.filter(isWaiting);
  const blockedHosts = new Set(opts.blockedHosts);
  for (const host of blockedHosts) log(`Host ${host}: feed already returned an access challenge; skipping job-page retries this run`);
  const queue = orderForVerification(ready);

  // Recovery probes: a host whose due roles are all waiting after a challenge still gets a few requests.
  const readyHosts = new Set(ready.map((r) => r.host));
  const probeCandidates = new Map<string, EligibleRole[]>();
  for (const role of orderForVerification(waiting)) {
    if (blockedHosts.has(role.host)) continue;
    if (!isBlockedReason(role.lastFailureReason) || readyHosts.has(role.host)) continue;
    const list = probeCandidates.get(role.host) ?? [];
    if (list.length < RECOVERY_PROBES_PER_HOST) list.push(role);
    probeCandidates.set(role.host, list);
  }
  const probes = [...probeCandidates.values()].flat();
  const probeIds = new Set(probes.map((r) => r.id));
  const work = [...queue, ...probes];

  const breakdown = new Map<string, SourceBreakdown>();
  const slot = (role: EligibleRole): SourceBreakdown => {
    const key = `${role.feed}\u0000${role.host}`;
    let entry = breakdown.get(key);
    if (!entry) {
      entry = {
        feed: role.feed, host: role.host, due: 0, waitingAtStart: 0, attempted: 0, verified: 0, closed: 0,
        unreadable: 0, failed: 0, blocked: 0, hostBlockedSkipped: 0, deferred: 0,
      };
      breakdown.set(key, entry);
    }
    return entry;
  };
  for (const role of due) slot(role).due += 1;
  for (const role of waiting) slot(role).waitingAtStart += 1;

  log(
    `Aggregator verification: due ${due.length} (last verified before ${cutoff.toISOString()} or never); ` +
    `ready ${queue.length}; waiting on retry at start ${waiting.length}; recovery probes planned ${probes.length}; ` +
    `ineligible (concluded/expired, never stamped) ${ineligibleRows.length}; ` +
    `pages read ${loaded.pagination.pages}; pagination ${loaded.pagination.complete ? 'complete' : 'INCOMPLETE'} ` +
    `(${loaded.pagination.stopReason})`,
  );

  const result: StaleSweepResult = {
    eligible: queue.length,
    waitingRetry: waiting.length,
    retryWaitingAtStart: waiting.length,
    retryScheduledAtEnd: 0,
    ineligible: ineligibleRows.length,
    attempted: 0,
    verified: 0,
    closed: 0,
    unreadable: 0,
    failed: 0,
    blocked: 0,
    hostBlockedSkipped: 0,
    recoveryProbes: 0,
    blockedHosts: [],
    recoveredHosts: [],
    retryCleared: 0,
    deferred: 0,
    writeFailures: 0,
    backlog: 0,
    bySource: [],
    pagination: loaded.pagination,
    cycleComplete: false,
    summaryPersisted: false,
  };

  let runId: string | null = null;
  {
    const { data, error } = await db.from('aggregator_verification_runs')
      .insert({
        started_at: runStart.toISOString(),
        status: 'running',
        eligible: result.eligible,
        waiting_retry: result.retryWaitingAtStart,
        pagination_complete: loaded.pagination.complete,
        pagination_stop_reason: loaded.pagination.stopReason.slice(0, MAX_REASON_CHARS),
      })
      .select('id')
      .single();
    if (error) log(`ERROR cannot record verification run start: ${error.message}`);
    else runId = String((data as { id: unknown }).id);
  }

  /** Roles with a future next_verification_at. Starts as the waiting set and follows each write. */
  const scheduled = new Set(waiting.map((r) => r.id));

  /** One update per attempt. Returns false when the write errored or matched no row. */
  async function record(role: EligibleRole, outcome: Outcome): Promise<boolean> {
    const at = stampTime().toISOString();
    let patch: Record<string, unknown>;
    if (outcome.kind === 'live') {
      patch = {
        last_verified_at: at,
        last_verification_attempt_at: at,
        last_verification_failure_at: null,
        last_verification_failure_reason: null,
        verification_failure_count: 0,
        next_verification_at: null,
      };
    } else if (outcome.kind === 'closed') {
      // last_verified_at is left exactly as it was.
      patch = {
        listing_status: 'Closed',
        last_verification_attempt_at: at,
        next_verification_at: null,
      };
    } else {
      // failed, unreadable or blocked: last_verified_at and listing_status are never part of this patch.
      const count = role.failureCount + 1;
      const retry = outcome.kind === 'blocked' ? nextBlockedRetryAt(stampTime(), count) : nextRetryAt(stampTime(), count);
      patch = {
        last_verification_attempt_at: at,
        last_verification_failure_at: at,
        last_verification_failure_reason: outcome.reason.slice(0, MAX_REASON_CHARS),
        verification_failure_count: count,
        next_verification_at: retry.toISOString(),
      };
    }
    const { data, error } = await db.from('roles')
      .update(patch)
      .eq('id', role.id)
      .eq('source', 'aggregator')
      .eq('listing_status', 'Active')
      .select('id');
    if (error) {
      log(`ERROR verification write ${role.id}: ${error.message}`);
      return false;
    }
    if (!data || data.length === 0) {
      log(`ERROR verification write ${role.id}: row changed or closed before the write`);
      return false;
    }
    if (outcome.kind === 'live' || outcome.kind === 'closed') scheduled.delete(role.id);
    else scheduled.add(role.id);
    return true;
  }

  const consecutiveChallenges = new Map<string, number>();
  const recoveredHosts = new Set<string>();
  const rateLimitedHosts = new Set<string>();

  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY) }, async () => {
    for (;;) {
      const role = work[cursor++];
      if (!role) return;
      const entry = slot(role);
      if (blockedHosts.has(role.host)) {
        // Not attempted and not written: its attempt time and retry state stay as they were.
        if (probeIds.has(role.id)) continue;
        result.hostBlockedSkipped += 1;
        entry.hostBlockedSkipped += 1;
        continue;
      }
      if (clock() > deadline) {
        if (probeIds.has(role.id)) continue;
        result.deferred += 1;
        entry.deferred += 1;
        continue;
      }
      if (rateLimitedHosts.has(role.host)) {
        // Respect Himalayas' API limit: leave unreached jobs queued for a later run.
        if (!probeIds.has(role.id)) { result.deferred += 1; entry.deferred += 1; }
        continue;
      }
      result.attempted += 1;
      entry.attempted += 1;
      if (probeIds.has(role.id)) result.recoveryProbes += 1;
      let outcome: Outcome;
      try {
        outcome = await checkRole(role, fetchImpl, stampTime());
      } catch (error) {
        outcome = { kind: 'failed', reason: classifyFetchError(error) };
      }
      if (role.feed === 'himalayas' && outcome.kind === 'failed' && outcome.reason === 'http-429') {
        rateLimitedHosts.add(role.host);
        log(`Host ${role.host}: API rate limited; deferring its remaining checks until a later run`);
      }
      if (outcome.kind === 'blocked') {
        const streak = (consecutiveChallenges.get(role.host) ?? 0) + 1;
        consecutiveChallenges.set(role.host, streak);
        if (streak >= HOST_BLOCK_THRESHOLD && !blockedHosts.has(role.host)) {
          blockedHosts.add(role.host);
          log(`Host ${role.host}: ${streak} consecutive access challenges; skipping its remaining roles this run`);
        }
      } else {
        consecutiveChallenges.set(role.host, 0);
        // A timeout, plain 403, 5xx, login page or malformed response proves
        // nothing about recovery. Only role-specific evidence can reopen work.
        if ((outcome.kind === 'live' || outcome.kind === 'closed') && isBlockedReason(role.lastFailureReason)) recoveredHosts.add(role.host);
      }
      const written = await record(role, outcome);
      if (!written) result.writeFailures += 1;
      if (outcome.kind === 'live' && written) { result.verified += 1; entry.verified += 1; }
      else if (outcome.kind === 'closed' && written) { result.closed += 1; entry.closed += 1; }
      else if (outcome.kind === 'unreadable') { result.unreadable += 1; entry.unreadable += 1; }
      else if (outcome.kind === 'blocked') { result.blocked += 1; entry.blocked += 1; }
      else { result.failed += 1; entry.failed += 1; } // failed fetches, plus live/closed verdicts whose write did not land
    }
  });
  await Promise.all(workers);

  // A recovered host's waiting blocked roles become due again next run. Only the retry time changes.
  for (const host of recoveredHosts) {
    if (blockedHosts.has(host)) continue; // challenged again later in the same run: not recovered
    const ids = waiting
      .filter((r) => r.host === host && isBlockedReason(r.lastFailureReason) && !probeIds.has(r.id))
      .map((r) => r.id);
    for (let offset = 0; offset < ids.length; offset += WRITE_BATCH) {
      const batch = ids.slice(offset, offset + WRITE_BATCH);
      const { data, error } = await db.from('roles')
        .update({ next_verification_at: null })
        .in('id', batch)
        .eq('source', 'aggregator')
        .eq('listing_status', 'Active')
        .select('id');
      if (error) {
        result.writeFailures += batch.length;
        log(`ERROR clearing retry times for recovered host ${host}: ${error.message}`);
        continue;
      }
      const cleared = (data ?? []) as Array<{ id: unknown }>;
      result.retryCleared += cleared.length;
      result.writeFailures += batch.length - cleared.length;
      for (const row of cleared) scheduled.delete(String(row.id));
    }
    result.recoveredHosts.push(host);
    log(`Host ${host}: answered without a challenge; rescheduled its waiting blocked roles for the next run`);
  }

  result.blockedHosts = [...blockedHosts].sort();
  result.recoveredHosts.sort();
  result.retryScheduledAtEnd = scheduled.size;
  result.backlog = due.length - result.verified - result.closed;
  result.bySource = [...breakdown.values()].sort((a, b) => b.due - a.due || a.feed.localeCompare(b.feed));
  result.cycleComplete = result.pagination.complete && result.deferred === 0 && result.hostBlockedSkipped === 0 &&
    !due.some(role => blockedHosts.has(role.host));

  if (runId) {
    const base = {
      finished_at: new Date().toISOString(),
      status: result.cycleComplete ? 'completed' : 'incomplete',
      attempted: result.attempted,
      verified: result.verified,
      closed: result.closed,
      unreadable: result.unreadable,
      failed: result.failed,
      deferred: result.deferred,
      write_failures: result.writeFailures,
      backlog: result.backlog,
      cycle_complete: result.cycleComplete,
    };
    const extended = {
      ...base,
      blocked: result.blocked,
      host_blocked_skipped: result.hostBlockedSkipped,
      recovery_probes: result.recoveryProbes,
      retry_cleared: result.retryCleared,
      retry_waiting_at_start: result.retryWaitingAtStart,
      retry_scheduled_at_end: result.retryScheduledAtEnd,
      blocked_hosts: result.blockedHosts,
      recovered_hosts: result.recoveredHosts,
      by_source: result.bySource,
      feeds: opts.feeds ?? null,
    };
    let { error } = await db.from('aggregator_verification_runs').update(extended).eq('id', runId);
    if (error && isMissingColumnError(error.message)) {
      log(`WARN run summary columns missing (${error.message}); apply supabase/migrations/0008_verification_blocked_reporting.sql. Saving base counts only.`);
      ({ error } = await db.from('aggregator_verification_runs').update(base).eq('id', runId));
    }
    if (error) log(`ERROR cannot record verification run summary: ${error.message}`);
    else result.summaryPersisted = true;
  }

  for (const s of result.bySource) {
    log(
      `  ${s.feed} @ ${s.host}: due ${s.due}; waiting at start ${s.waitingAtStart}; attempted ${s.attempted}; ` +
      `verified ${s.verified}; closed ${s.closed}; unreadable ${s.unreadable}; failed ${s.failed}; ` +
      `blocked ${s.blocked}; host-blocked skipped ${s.hostBlockedSkipped}; deferred ${s.deferred}`,
    );
  }
  log(
    `Aggregator verification summary: eligible ${result.eligible}; attempted ${result.attempted} ` +
    `(recovery probes ${result.recoveryProbes}); verified ${result.verified}; closed ${result.closed}; ` +
    `unreadable ${result.unreadable}; failed ${result.failed}; blocked ${result.blocked}; ` +
    `host-blocked skipped ${result.hostBlockedSkipped}; deferred ${result.deferred}; write failures ${result.writeFailures}; ` +
    `backlog ${result.backlog}; waiting on retry at start ${result.retryWaitingAtStart}, at end ${result.retryScheduledAtEnd}; ` +
    `ineligible ${result.ineligible}; blocked hosts [${result.blockedHosts.join(', ')}]; ` +
    `recovered hosts [${result.recoveredHosts.join(', ')}]; ` +
    `cycle ${result.cycleComplete ? 'COMPLETE' : 'NOT complete'}` +
    (result.deferred ? ' (time budget ended; deferred roles lead the next run)' : '') +
    (result.hostBlockedSkipped ? ' (blocked hosts skipped; those roles remain unverified)' : ''),
  );
  return result;
}
