import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidHttpUrl } from '../util';
import { judgePage, type PageVerdictKind } from './pageEvidence';

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
 */

/** The verification interval the product promises. */
export const VERIFICATION_TARGET_HOURS = 24;
/**
 * Daily schedulers drift by minutes or hours. A job last verified 23h50m ago
 * must not wait another full day, so anything older than target minus this
 * slack is already due.
 */
export const VERIFICATION_JITTER_HOURS = 2;
/** Rows verified at or before now minus this many hours are eligible. */
export const STALE_AFTER_HOURS = VERIFICATION_TARGET_HOURS - VERIFICATION_JITTER_HOURS;
/** Retry delays after consecutive unverified attempts. Capped below the daily jitter window. */
export const RETRY_BACKOFF_HOURS = [2, 6, 12];

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 600_000;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_BUDGET_MS = 45 * 60 * 1000;
const MAX_REASON_CHARS = 200;

export function verificationCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_AFTER_HOURS * HOUR_MS);
}

/** When an unverified role may be tried again, given its consecutive failure count (1-based). */
export function nextRetryAt(now: Date, failureCount: number): Date {
  const index = Math.min(Math.max(failureCount, 1), RETRY_BACKOFF_HOURS.length) - 1;
  return new Date(now.getTime() + RETRY_BACKOFF_HOURS[index] * HOUR_MS);
}

export interface PaginationReport {
  pages: number;
  complete: boolean;
  /** Why paging ended. Anything other than an empty final page makes the scan incomplete. */
  stopReason: string;
}

export interface StaleSweepResult {
  /** Active aggregator roles due for verification and not waiting on a retry time. */
  eligible: number;
  /** Due roles skipped because an earlier unverified attempt scheduled a later retry. */
  waitingRetry: number;
  attempted: number;
  /** Role-specific evidence found AND recorded. */
  verified: number;
  /** Explicit 404/410 on the original URL, recorded. */
  closed: number;
  /** Page reached but no evidence for this role (generic page, login, search, unrelated posting...). */
  unreadable: number;
  /** Timeouts, 403/429/5xx, network errors, and database writes that did not land. */
  failed: number;
  /** Eligible roles not attempted before the time budget ended. They stay first in line next run. */
  deferred: number;
  /** Database writes that failed or matched no row. Also counted in failed (or the attempt's own category). */
  writeFailures: number;
  /** eligible - verified - closed: still stale after this run. */
  backlog: number;
  pagination: PaginationReport;
  /** True when every eligible role was attempted and the eligible list was read completely. */
  cycleComplete: boolean;
  summaryPersisted: boolean;
}

type EligibleRole = {
  id: string;
  title: string;
  applyUrl: string;
  companyName: string | null;
  lastVerifiedAt: string | null;
  lastAttemptAt: string | null;
  failureCount: number;
  nextVerificationAt: string | null;
};

type Outcome = { kind: PageVerdictKind; reason: string };

const ROLE_COLUMNS =
  'id,title,apply_url,last_verified_at,last_verification_attempt_at,verification_failure_count,next_verification_at,companies(name)';

function companyNameOf(row: Record<string, unknown>): string | null {
  const c = row.companies;
  const one = Array.isArray(c) ? c[0] : c;
  const name = one && typeof one === 'object' ? (one as { name?: unknown }).name : null;
  return typeof name === 'string' && name.trim() ? name : null;
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
      pagination.stopReason = `database error after ${pagination.pages} page(s): ${error.message}`;
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
      rows.push({
        id: String(row.id),
        title: typeof row.title === 'string' ? row.title : '',
        applyUrl: typeof row.apply_url === 'string' ? row.apply_url : '',
        companyName: companyNameOf(row),
        lastVerifiedAt: typeof row.last_verified_at === 'string' ? row.last_verified_at : null,
        lastAttemptAt: typeof row.last_verification_attempt_at === 'string' ? row.last_verification_attempt_at : null,
        failureCount: typeof row.verification_failure_count === 'number' ? row.verification_failure_count : 0,
        nextVerificationAt: typeof row.next_verification_at === 'string' ? row.next_verification_at : null,
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
  }
  const verdict = judgePage({
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body,
    role: { title: role.title, companyName: role.companyName },
    requestedUrl: role.applyUrl,
    finalUrl: response.url || null,
    now,
  });
  return { kind: verdict.verdict, reason: verdict.reason };
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

  const loaded = await loadEligibleRoles(db, cutoff, opts.pageSize ?? DEFAULT_PAGE_SIZE);
  const due = loaded.rows;
  const ready = due.filter((r) => !r.nextVerificationAt || Date.parse(r.nextVerificationAt) <= runStart.getTime());
  const queue = orderForVerification(ready);
  log(
    `Aggregator verification: due ${due.length} (last verified before ${cutoff.toISOString()} or never); ` +
    `ready ${queue.length}; waiting on retry ${due.length - queue.length}; ` +
    `pages read ${loaded.pagination.pages}; pagination ${loaded.pagination.complete ? 'complete' : 'INCOMPLETE'} ` +
    `(${loaded.pagination.stopReason})`,
  );

  const result: StaleSweepResult = {
    eligible: queue.length,
    waitingRetry: due.length - queue.length,
    attempted: 0,
    verified: 0,
    closed: 0,
    unreadable: 0,
    failed: 0,
    deferred: 0,
    writeFailures: 0,
    backlog: 0,
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
        waiting_retry: result.waitingRetry,
        pagination_complete: loaded.pagination.complete,
        pagination_stop_reason: loaded.pagination.stopReason.slice(0, MAX_REASON_CHARS),
      })
      .select('id')
      .single();
    if (error) log(`ERROR cannot record verification run start: ${error.message}`);
    else runId = String((data as { id: unknown }).id);
  }

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
      const count = role.failureCount + 1;
      patch = {
        last_verification_attempt_at: at,
        last_verification_failure_at: at,
        last_verification_failure_reason: outcome.reason.slice(0, MAX_REASON_CHARS),
        verification_failure_count: count,
        next_verification_at: nextRetryAt(stampTime(), count).toISOString(),
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
    return true;
  }

  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY) }, async () => {
    for (;;) {
      const role = queue[cursor++];
      if (!role) return;
      if (clock() > deadline) {
        result.deferred += 1;
        continue;
      }
      result.attempted += 1;
      let outcome: Outcome;
      try {
        outcome = await checkRole(role, fetchImpl, stampTime());
      } catch (error) {
        outcome = { kind: 'failed', reason: classifyFetchError(error) };
      }
      const written = await record(role, outcome);
      if (!written) result.writeFailures += 1;
      if (outcome.kind === 'live' && written) result.verified += 1;
      else if (outcome.kind === 'closed' && written) result.closed += 1;
      else if (outcome.kind === 'unreadable') result.unreadable += 1;
      else result.failed += 1; // failed fetches, plus live/closed verdicts whose write did not land
    }
  });
  await Promise.all(workers);

  result.backlog = result.eligible - result.verified - result.closed;
  result.cycleComplete = result.pagination.complete && result.deferred === 0;

  if (runId) {
    const { error } = await db.from('aggregator_verification_runs')
      .update({
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
      })
      .eq('id', runId);
    if (error) log(`ERROR cannot record verification run summary: ${error.message}`);
    else result.summaryPersisted = true;
  }

  log(
    `Aggregator verification summary: eligible ${result.eligible}; attempted ${result.attempted}; ` +
    `verified ${result.verified}; closed ${result.closed}; unreadable ${result.unreadable}; ` +
    `failed ${result.failed}; deferred ${result.deferred}; write failures ${result.writeFailures}; ` +
    `backlog ${result.backlog}; waiting on retry ${result.waitingRetry}; ` +
    `cycle ${result.cycleComplete ? 'COMPLETE' : 'NOT complete'}` +
    (result.deferred ? ' (time budget ended; deferred roles lead the next run)' : ''),
  );
  return result;
}
