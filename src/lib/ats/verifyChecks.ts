/**
 * Server-side only. Per-role checks for ATS-sourced roles that the board download
 * did not refresh: Workday detail pages, and Greenhouse/Lever/Ashby board
 * membership. Extracted from scripts/sync-all-sources.ts so they can be tested.
 *
 * Shared rules with the aggregator sweep:
 *  - Loaders page until an empty page (dbPaging.ts) and include NULL last_verified_at.
 *  - A role is counted as verified/closed only when the database returned the row.
 *  - Concluded or expired roles (verifyEligibility.ts) never get a fresh timestamp.
 *  - A failed check never changes last_verified_at. When the 0007 columns exist,
 *    the attempt is recorded in last_verification_attempt_at / failure columns.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FetchLike } from './types';
import { loadAllPages, type PagedLoad } from './dbPaging';
import { ELIGIBILITY_COLUMNS, verificationBlocker } from './verifyEligibility';
import { planEmployerConfirmation, type ConfirmableRole, type FailedBoard } from './employerConfirm';
import { parseWorkdayToken } from './providers/workday';
import { blockedReason, detectAccessChallenge, type HeaderSource } from './accessChallenge';
import { fetchRetrying } from './fetchRetry';
import { titleMatches } from './aggregators/pageEvidence';
import { HOST_BLOCK_THRESHOLD, nextBlockedRetryAt, nextRetryAt } from './aggregators/staleSweep';

const DEFAULT_PAGE_SIZE = 1000;
const WRITE_BATCH = 100;
const MAX_REASON_CHARS = 200;

type Log = (message: string) => void;

export interface CoverageReport {
  pages: number;
  complete: boolean;
  stopReason: string;
}

function coverageOf(load: PagedLoad<{ id: string }>): CoverageReport {
  return { pages: load.pages, complete: load.complete, stopReason: load.stopReason };
}

/** Update one batch and return how many rows the database actually changed. */
async function updateReturningCount(
  run: () => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<{ updated: number; error: string | null }> {
  const { data, error } = await run();
  if (error) return { updated: 0, error: error.message };
  return { updated: Array.isArray(data) ? data.length : 0, error: null };
}

// ---------------------------------------------------------------- Workday

export interface WorkdayRecheckResult {
  /** Active Workday roles not refreshed by this run's list download (NULL timestamps included). */
  candidates: number;
  /** Candidates whose apply URL is not a job link on this company's Workday tenant. */
  unmapped: number;
  /** Candidates the pipeline's own rules treat as concluded/expired: not fetched, not stamped. */
  ineligible: number;
  /** Candidates whose next_verification_at is still in the future (earlier failure or challenge). */
  waitingRetry: number;
  attempted: number;
  verified: number;
  closed: number;
  /** Job data returned but not usable as evidence (no data, not accepting applications, title mismatch). */
  unreadable: number;
  /** Transport errors and plain 403/429/5xx after retries. */
  failed: number;
  /** Explicit access challenges (see accessChallenge.ts). Not included in failed. */
  blocked: number;
  /** Not attempted because their host kept serving challenges earlier in this run. */
  hostBlockedSkipped: number;
  /** Not attempted before the time budget ended. Their attempt time is unchanged, so they lead the next run. */
  deferred: number;
  /** Writes that errored or matched no row. */
  writeFailures: number;
  /** Count of each stored failure reason this run, e.g. { 'http-521': 12, timeout: 3 }. */
  failureReasons: Record<string, number>;
  blockedHosts: string[];
  coverage: CoverageReport;
  /** True when the candidate list was read completely, every ready role was attempted and every write landed. */
  clean: boolean;
}

/** Tenant of a Workday apply URL: first host label on myworkdayjobs.com, or /recruiting/{tenant}/ on myworkdaysite.com. */
function workdayTenantOf(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.myworkdayjobs.com')) return host.split('.')[0];
  if (host.endsWith('.myworkdaysite.com')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const at = parts.indexOf('recruiting');
    return at >= 0 && parts[at + 1] ? parts[at + 1].toLowerCase() : null;
  }
  return null;
}

/**
 * Detail-API URL for one job. Workday resolves the job by the id at the end of
 * the path, whichever career site name is used (checked against a live tenant),
 * but only within one tenant. A link to another tenant (for example an
 * aggregator row matched to the wrong company) is not mapped, because its 404
 * would say nothing about this company's job.
 */
export function workdayDetailUrl(token: string, applyUrl: string): string | null {
  const coords = parseWorkdayToken(token);
  if (!coords) return null;
  try {
    const url = new URL(applyUrl);
    const tenant = workdayTenantOf(url);
    if (!tenant || tenant !== coords.tenant.toLowerCase()) return null;
    const jobPath = url.pathname;
    const jobAt = jobPath.indexOf('/job/');
    if (jobAt < 0) return null;
    return `https://${coords.host}/wday/cxs/${encodeURIComponent(coords.tenant)}/${encodeURIComponent(coords.site)}${jobPath.slice(jobAt)}`;
  } catch {
    return null;
  }
}

type WorkdayRow = {
  id: string;
  company_id: string;
  apply_url: string | null;
  title?: string | null;
  seasons?: unknown;
  cohort_year?: unknown;
  application_deadline?: string | null;
  verification_failure_count?: number | null;
  last_verification_attempt_at?: string | null;
  next_verification_at?: string | null;
};

type WorkdayDetail = { jobPostingInfo?: { title?: unknown; canApply?: unknown } | null };

export async function recheckWorkdayRoles(
  db: SupabaseClient,
  opts: {
    /** Roles verified at or after this instant were refreshed by this run's list download. */
    refreshedSince: Date;
    now?: Date;
    fetchImpl?: FetchLike;
    pageSize?: number;
    concurrency?: number;
    /** Time budget for detail requests. Unreached roles are deferred, not failed. */
    budgetMs?: number;
    /** Millisecond clock for the budget. Injectable for tests. */
    clock?: () => number;
    /** Record failed attempts in the 0007 columns. Defaults to true. */
    recordAttempts?: boolean;
    log?: Log;
  },
): Promise<WorkdayRecheckResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const recordAttempts = opts.recordAttempts ?? true;
  const clock = opts.clock ?? Date.now;
  const deadline = clock() + (opts.budgetMs ?? 20 * 60 * 1000);
  const result: WorkdayRecheckResult = {
    candidates: 0, unmapped: 0, ineligible: 0, waitingRetry: 0, attempted: 0, verified: 0, closed: 0,
    unreadable: 0, failed: 0, blocked: 0, hostBlockedSkipped: 0, deferred: 0, writeFailures: 0,
    failureReasons: {}, blockedHosts: [],
    coverage: { pages: 0, complete: false, stopReason: 'not started' },
    clean: false,
  };

  const companies = await loadAllPages<{ id: string; ats_board_token: string | null }>((after) => {
    let q = db.from('companies').select('id,ats_board_token')
      .eq('ats_provider', 'workday')
      .not('ats_board_token', 'is', null)
      .order('id', { ascending: true }).limit(pageSize);
    if (after) q = q.gt('id', after);
    return q as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  });
  if (!companies.complete) {
    result.coverage = { ...coverageOf(companies), stopReason: `companies: ${companies.stopReason}` };
    log(`ERROR workday recheck: ${result.coverage.stopReason}`);
    return result;
  }
  const tokens = new Map<string, string>();
  for (const c of companies.rows) if (typeof c.ats_board_token === 'string') tokens.set(String(c.id), c.ats_board_token);
  const companyIds = [...tokens.keys()];

  const cutoff = opts.refreshedSince.toISOString();
  const candidates: Array<WorkdayRow & { url: string; host: string }> = [];
  let pages = 0;
  for (let index = 0; index < companyIds.length; index += 40) {
    const ids = companyIds.slice(index, index + 40);
    const load = await loadAllPages<WorkdayRow>((after) => {
      let q = db.from('roles')
        .select(`id,company_id,apply_url,${ELIGIBILITY_COLUMNS},verification_failure_count,last_verification_attempt_at,next_verification_at`)
        .eq('listing_status', 'Active')
        .or(`last_verified_at.is.null,last_verified_at.lt.${cutoff}`)
        .in('company_id', ids)
        .order('id', { ascending: true }).limit(pageSize);
      if (after) q = q.gt('id', after);
      return q as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    });
    pages += load.pages;
    if (!load.complete) {
      result.coverage = { pages, complete: false, stopReason: `roles: ${load.stopReason}` };
      log(`ERROR workday recheck: ${result.coverage.stopReason}`);
      return result;
    }
    for (const row of load.rows) {
      result.candidates += 1;
      const token = tokens.get(String(row.company_id));
      const url = token && row.apply_url ? workdayDetailUrl(token, row.apply_url) : null;
      if (!url) { result.unmapped += 1; continue; }
      if (verificationBlocker(row, now)) { result.ineligible += 1; continue; }
      if (row.next_verification_at && Date.parse(row.next_verification_at) > now.getTime()) { result.waitingRetry += 1; continue; }
      candidates.push({ ...row, url, host: new URL(url).hostname });
    }
  }
  result.coverage = { pages, complete: true, stopReason: 'empty page reached' };

  // Fair progress: never-attempted first, then least recently attempted.
  const attemptKey = (r: WorkdayRow) => (r.last_verification_attempt_at ? Date.parse(r.last_verification_attempt_at) : Number.NEGATIVE_INFINITY);
  candidates.sort((a, b) => attemptKey(a) - attemptKey(b) || a.id.localeCompare(b.id));

  async function write(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const { updated, error } = await updateReturningCount(() =>
      db.from('roles').update(patch).eq('id', id).eq('listing_status', 'Active').select('id') as unknown as
        PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
    if (error) log(`ERROR workday write ${id}: ${error}`);
    else if (updated === 0) log(`ERROR workday write ${id}: row changed or closed before the write`);
    if (error || updated === 0) { result.writeFailures += 1; return false; }
    return true;
  }

  async function recordFailure(row: WorkdayRow, reason: string, blocked = false): Promise<void> {
    result.failureReasons[reason] = (result.failureReasons[reason] ?? 0) + 1;
    if (!recordAttempts) return;
    const at = now.toISOString();
    const count = (row.verification_failure_count ?? 0) + 1;
    // last_verified_at and listing_status are never part of a failure write.
    await write(row.id, {
      last_verification_attempt_at: at,
      last_verification_failure_at: at,
      last_verification_failure_reason: reason.slice(0, MAX_REASON_CHARS),
      verification_failure_count: count,
      next_verification_at: (blocked ? nextBlockedRetryAt(now, count) : nextRetryAt(now, count)).toISOString(),
    });
  }

  const streaks = new Map<string, number>();
  const blockedHosts = new Set<string>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, async () => {
    for (;;) {
      const item = candidates[cursor++];
      if (!item) return;
      if (blockedHosts.has(item.host)) { result.hostBlockedSkipped += 1; continue; }
      if (clock() > deadline) { result.deferred += 1; continue; }
      result.attempted += 1;
      let status = 0;
      let body: WorkdayDetail | null = null;
      let challenge: ReturnType<typeof detectAccessChallenge> = null;
      try {
        const response = await fetchRetrying(
          fetchImpl, item.url,
          { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) },
          `Workday detail ${item.id}`,
        );
        status = response.status;
        challenge = detectAccessChallenge(status, (response as { headers?: HeaderSource }).headers);
        if (response.ok) body = (await response.json().catch(() => null)) as WorkdayDetail | null;
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        result.failed += 1;
        await recordFailure(item, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network-error');
        continue;
      }
      if (challenge) {
        // Never open or closed evidence. Only the attempt is recorded, with the long backoff.
        result.blocked += 1;
        const streak = (streaks.get(item.host) ?? 0) + 1;
        streaks.set(item.host, streak);
        if (streak >= HOST_BLOCK_THRESHOLD && !blockedHosts.has(item.host)) {
          blockedHosts.add(item.host);
          log(`Workday host ${item.host}: ${streak} consecutive access challenges; skipping its remaining roles this run`);
        }
        await recordFailure(item, blockedReason(challenge), true);
        continue;
      }
      streaks.set(item.host, 0);
      if (status === 404 || status === 410) {
        // Workday answers an unknown job id on a reachable tenant with an explicit 404.
        if (await write(item.id, { listing_status: 'Closed', ...(recordAttempts ? { last_verification_attempt_at: now.toISOString(), next_verification_at: null } : {}) })) result.closed += 1;
        else result.failed += 1;
        continue;
      }
      if (status === 403 || status === 408 || status === 429 || status >= 500 || status === 0) {
        result.failed += 1;
        await recordFailure(item, `http-${status}`);
        continue;
      }
      const info = body?.jobPostingInfo;
      if (!info || typeof info !== 'object') {
        result.unreadable += 1;
        await recordFailure(item, status >= 200 && status < 300 ? 'no-job-data' : `http-${status}`);
        continue;
      }
      if (info.canApply === false) {
        // The posting exists but says it is not taking applications. Not closed from this; not verified either.
        result.unreadable += 1;
        await recordFailure(item, 'not-accepting-applications');
        continue;
      }
      if (item.title && typeof info.title === 'string' && !titleMatches(item.title, info.title)) {
        result.unreadable += 1;
        await recordFailure(item, 'title-mismatch');
        continue;
      }
      const at = now.toISOString();
      const ok = await write(item.id, recordAttempts
        ? {
          last_verified_at: at, last_verification_attempt_at: at, last_verification_failure_at: null,
          last_verification_failure_reason: null, verification_failure_count: 0, next_verification_at: null,
        }
        : { last_verified_at: at });
      if (ok) result.verified += 1;
      else result.failed += 1;
    }
  }));

  result.blockedHosts = [...blockedHosts].sort();
  result.clean = result.coverage.complete && result.writeFailures === 0 && result.deferred === 0 && result.hostBlockedSkipped === 0;
  const reasons = Object.entries(result.failureReasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ');
  log(
    `Workday page check: candidates ${result.candidates} (NULL timestamps included); unmapped ${result.unmapped}; ` +
    `ineligible ${result.ineligible}; waiting on retry ${result.waitingRetry}; attempted ${result.attempted}; ` +
    `verified ${result.verified}; closed ${result.closed}; unreadable ${result.unreadable}; failed ${result.failed}; ` +
    `blocked ${result.blocked}; host-blocked skipped ${result.hostBlockedSkipped}; deferred ${result.deferred}; ` +
    `write failures ${result.writeFailures}; reasons [${reasons}]; pages ${result.coverage.pages} (${result.coverage.stopReason})`,
  );
  return result;
}
// ---------------------------------------------------------------- Employer boards

export interface EmployerConfirmResult {
  rolesScanned: number;
  boardsChecked: number;
  boardsFailed: number;
  /** skippedUnsupported + skippedBoardFailed. */
  skipped: number;
  /** Expected: the apply URL is not a Greenhouse, Lever or Ashby job link. Checked by other stages or not at all. */
  skippedUnsupported: number;
  /** Jobs on boards that could not be read: neither confirmed nor closed. */
  skippedBoardFailed: number;
  failedBoards: FailedBoard[];
  /** Largest unsupported apply-URL hosts. */
  unsupportedHosts: Array<{ host: string; roles: number }>;
  /** On a readable board but concluded/expired by the pipeline's own rules: not stamped. */
  ineligible: number;
  /** Rows the database actually stamped / closed. */
  confirmed: number;
  closed: number;
  /** Planned writes that errored or matched fewer rows than requested. */
  writeFailures: number;
  coverage: CoverageReport;
  /** Every active role was read, every board was readable, and every write landed. */
  clean: boolean;
}

type EmployerRow = {
  id: string;
  apply_url: string | null;
  title?: string | null;
  seasons?: unknown;
  cohort_year?: unknown;
  application_deadline?: string | null;
  companies?: unknown;
};

export async function confirmEmployerRoles(
  db: SupabaseClient,
  opts: { now?: Date; fetchImpl?: FetchLike; pageSize?: number; log?: Log } = {},
): Promise<EmployerConfirmResult> {
  const log = opts.log ?? (() => undefined);
  const now = opts.now ?? new Date();
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const result: EmployerConfirmResult = {
    rolesScanned: 0, boardsChecked: 0, boardsFailed: 0, skipped: 0, skippedUnsupported: 0, skippedBoardFailed: 0,
    failedBoards: [], unsupportedHosts: [], ineligible: 0,
    confirmed: 0, closed: 0, writeFailures: 0,
    coverage: { pages: 0, complete: false, stopReason: 'not started' }, clean: false,
  };

  const load = await loadAllPages<EmployerRow>((after) => {
    let q = db.from('roles')
      .select(`id,apply_url,${ELIGIBILITY_COLUMNS},companies(ats_provider,ats_board_token)`)
      .eq('listing_status', 'Active')
      .order('id', { ascending: true }).limit(pageSize);
    if (after) q = q.gt('id', after);
    return q as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  });
  result.coverage = coverageOf(load);
  if (!load.complete) {
    // Each role is judged on its own board, so the rows that were read are still
    // checked. The unread remainder makes the stage unclean.
    log(`ERROR employer check: ${load.stopReason}`);
  }
  result.rolesScanned = load.rows.length;

  const blocked = new Set<string>();
  const roles: ConfirmableRole[] = load.rows.map((row) => {
    if (verificationBlocker(row, now)) blocked.add(String(row.id));
    const raw = row.companies;
    const company = (Array.isArray(raw) ? raw[0] : raw) as { ats_provider?: string | null; ats_board_token?: string | null } | null | undefined;
    return {
      id: String(row.id),
      applyUrl: typeof row.apply_url === 'string' ? row.apply_url : null,
      company: company ? { atsProvider: company.ats_provider ?? null, atsBoardToken: company.ats_board_token ?? null } : null,
    };
  });

  const plan = await planEmployerConfirmation(roles, opts.fetchImpl);
  result.boardsChecked = plan.boardsChecked;
  result.boardsFailed = plan.boardsFailed;
  result.skipped = plan.skipped;
  result.skippedUnsupported = plan.skippedUnsupported;
  result.skippedBoardFailed = plan.skippedBoardFailed;
  result.failedBoards = plan.failedBoards;
  result.unsupportedHosts = plan.unsupportedHosts.slice(0, 10);
  // Absent from a readable board still closes: the listing is gone either way.
  // Present on the board does not override the pipeline's own expiry rules.
  const confirmIds = plan.confirmIds.filter((id) => !blocked.has(id));
  result.ineligible = plan.confirmIds.length - confirmIds.length;

  const stamp = now.toISOString();
  for (let offset = 0; offset < plan.closeIds.length; offset += WRITE_BATCH) {
    const ids = plan.closeIds.slice(offset, offset + WRITE_BATCH);
    const { updated, error } = await updateReturningCount(() =>
      db.from('roles').update({ listing_status: 'Closed' }).in('id', ids).eq('listing_status', 'Active').select('id') as unknown as
        PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
    if (error) log(`ERROR employer close: ${error}`);
    result.closed += updated;
    result.writeFailures += ids.length - updated;
  }
  for (let offset = 0; offset < confirmIds.length; offset += WRITE_BATCH) {
    const ids = confirmIds.slice(offset, offset + WRITE_BATCH);
    const { updated, error } = await updateReturningCount(() =>
      // The job id is on the employer's own board: role-specific evidence. Clear any earlier failure state.
      db.from('roles').update({
        last_verified_at: stamp, last_verification_attempt_at: stamp, last_verification_failure_at: null,
        last_verification_failure_reason: null, verification_failure_count: 0, next_verification_at: null,
      }).in('id', ids).eq('listing_status', 'Active').select('id') as unknown as
        PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>);
    if (error) log(`ERROR employer confirm: ${error}`);
    result.confirmed += updated;
    result.writeFailures += ids.length - updated;
  }

  result.clean = result.coverage.complete && result.boardsFailed === 0 && result.writeFailures === 0;
  log(
    `Employer check: roles scanned ${result.rolesScanned}; boards ${result.boardsChecked}; failed boards ${result.boardsFailed}; ` +
    `confirmed ${result.confirmed}; closed ${result.closed}; ineligible ${result.ineligible}; ` +
    `skipped ${result.skipped} (unsupported URL ${result.skippedUnsupported}, on unreadable boards ${result.skippedBoardFailed}); ` +
    `write failures ${result.writeFailures}; pages ${result.coverage.pages} (${result.coverage.stopReason})`,
  );
  for (const board of result.failedBoards) {
    log(`  failed board ${board.provider}${board.region ? ' (' + board.region + ')' : ''} ${board.token}: ${board.reason}; ${board.roles} job(s) not checked`);
  }
  log(`  unsupported apply-URL hosts (expected; checked elsewhere or not at all): ${result.unsupportedHosts.map((h) => h.host + ' ' + h.roles).join(', ')}`);
  return result;
}
