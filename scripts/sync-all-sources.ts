/// <reference types="node" />

/**
 * Run the Launchpad ATS and aggregator pipelines from a trusted server/runner.
 *
 * Locally:
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --aggregators-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --ats-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts
 *
 * Two independent groups:
 *   aggregators  feed ingestion, then fallback page verification of active
 *                aggregator roles the feeds did not observe.
 *   ats          company boards, Workday recheck, employer-board confirmation.
 *
 * CI runs the groups as separate jobs. In one process (no flag) every stage is
 * isolated and aggregators run first, so an ATS exception or timeout cannot stop
 * aggregator verification.
 *
 * Aggregator feeds are downloaded once inside ingestAggregators. That pass
 * inserts new rows and refreshes verification timestamps for listings it
 * actually saw. It does not fetch the feeds again. Roles it did not see are
 * checked on their own page by sweepStaleAggregatorRoles: every active role not
 * verified since the start of the current UTC day (daily cohort, so schedule
 * drift cannot push a role to the following day).
 *
 * Exit status is non-zero when coverage was incomplete: a feed cut short, a
 * board that could not be read, deferred or unpaged roles, or a database write
 * that did not land. Unreadable pages are reported and retried, not fatal.
 *
 * Optional environment:
 *   AGGREGATOR_VERIFY_BUDGET_MINUTES  time budget for fallback verification (default 45)
 *
 * Do not expose SUPABASE_SERVICE_ROLE_KEY to the browser or commit it.
 */
import { appendFileSync } from 'node:fs';
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../src/lib/ats/supabaseSink';
import { syncAll, type SyncResult } from '../src/lib/ats/sync';
import { aggregatorRunSucceeded, ingestAggregators, type AggregatorResult } from '../src/lib/ats/aggregators/ingest';
import {
  confirmEmployerRoles,
  recheckWorkdayRoles,
  type EmployerConfirmResult,
  type WorkdayRecheckResult,
} from '../src/lib/ats/verifyChecks';
import { sweepStaleAggregatorRoles, type StaleSweepResult } from '../src/lib/ats/aggregators/staleSweep';
import { runStages, type PipelineStage, type StageOutcome } from '../src/lib/ats/pipeline';


const args = process.argv.slice(2);
const atsOnly = args.includes('--ats-only');
const aggregatorsOnly = args.includes('--aggregators-only');

if (atsOnly && aggregatorsOnly) {
  throw new Error('Choose one of --ats-only or --aggregators-only.');
}

const db = createServiceClient();

const MINUTE = 60_000;
const verifyBudgetMs = (() => {
  const minutes = Number(process.env.AGGREGATOR_VERIFY_BUDGET_MINUTES);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * MINUTE : 45 * MINUTE;
})();



const log = (message: string) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const atsResults: SyncResult[] = [];
const blockedWorkdayHosts = new Set<string>();

async function runAts(): Promise<boolean> {
  atsStartedAt = new Date();
  const companies = await loadSyncableCompanies(db);

  log(`Configured ATS companies: ${companies.length}`);

  let failures = 0;

  for (let offset = 0; offset < companies.length; offset += 8) {
    const batch = companies.slice(offset, offset + 8);

    const results = await syncAll(batch, new SupabaseSink(db), {
      concurrency: 4,
      timeoutMs: 480_000,
    });

    for (const result of results) {
      atsResults.push(result);
      if (result.coverage?.status === 'blocked' && result.coverage.host) {
        blockedWorkdayHosts.add(result.coverage.host);
      }
      log(`ATS ${result.company}: fetched ${result.fetched ?? 0}; eligible ${result.candidates ?? 0}; new ${result.imported}; refreshed ${result.updated}; closed ${result.closed}; coverage ${result.coverage?.status ?? (result.errors.length ? 'failed' : 'complete')}`);
      for (const warning of result.warnings ?? []) log(`WARN ${result.company}: ${warning}`);
      if (result.errors.length || result.coverage?.status === 'partial' || result.coverage?.status === 'blocked') {
        failures++;
        log(`ERROR ${result.company}: ${result.errors.join('; ') || result.coverage?.reason}`);
      }
    }

    log(`ATS ${Math.min(offset + 8, companies.length)}/${companies.length}`);
  }

  return failures === 0;
}

let ingestResults: AggregatorResult[] = [];

async function runAggregatorIngest(): Promise<boolean> {
  log('Importing and refreshing aggregator postings from a single fetch per source');

  const results = await ingestAggregators(db);
  ingestResults = results;

  for (const result of results) {
    log(
      `${result.source}: fetched ${result.fetched}; processed ${result.processed}; ` +
      `new ${result.rolesUpserted}; refreshed ${result.refreshed}; closed ${result.closed}; ` +
      `coverage ${result.coverage}; feedComplete ${result.feedComplete}; closeMissingEligible ${result.closeMissingEligible}` +
      `${result.feedPages === null ? '' : `; pages read ${result.feedPages}`}; ` +
      `stop reason: ${result.feedStopReason}; ` +
      `duplicates ${result.duplicatesSkipped}; invalid ${result.skippedInvalid}; ` +
      `expired ${result.skippedExpired}; companies ${result.companiesUpserted}; ` +
      `errors ${result.errors.length}; ${(result.durationMs / 1000).toFixed(1)}s`,
    );

    for (const error of result.errors.slice(0, 10)) {
      log(`ERROR ${result.source}: ${error}`);
    }
    if (result.errors.length > 10) {
      log(`ERROR ${result.source}: ${result.errors.length - 10} more errors omitted`);
    }
  }

  const inserted = results.reduce((sum, result) => sum + result.rolesUpserted, 0);
  const refreshed = results.reduce((sum, result) => sum + result.refreshed, 0);
  log(
    `Aggregator totals: new ${inserted}; refreshed ${refreshed}; ` +
    `sources with errors ${results.filter((result) => result.errors.length).length}. ` +
    'Unobserved jobs were not closed or re-stamped here; fallback verification handles them next.',
  );
  const partial = results.filter((r) => r.coverage === 'partial' || r.coverage === 'failed' || r.coverage === 'blocked');
  for (const r of results.filter((x) => x.coverage === 'blocked')) {
    log(`BLOCKED ${r.source}: ${r.accessChallenge?.evidence ?? 'access challenge'}. Its listings were neither refreshed nor closed; fallback checks will back off.`);
  }
  if (partial.length) {
    log(
      `Feeds NOT fully read: ${partial.map((r) => `${r.source} (${r.coverage}: ${r.feedStopReason})`).join('; ')}. ` +
      'Postings that were read were saved; jobs beyond the cut-off were neither refreshed nor closed.',
    );
  }

  return aggregatorRunSucceeded(results);
}

let sweepResult: StaleSweepResult | null = null;

async function runAggregatorVerification(): Promise<boolean> {
  log('Fallback verification of active aggregator roles the feeds did not observe');
  const feeds = ingestResults.map((r) => ({
    source: r.source, coverage: r.coverage, fetched: r.fetched, refreshed: r.refreshed,
    stopReason: r.feedStopReason.slice(0, 300), accessChallenge: r.accessChallenge ?? null,
  }));
  const blockedHosts = new Set(ingestResults.flatMap(r =>
    r.coverage === 'blocked' && r.accessChallenge?.host ? [r.accessChallenge.host] : []));
  sweepResult = await sweepStaleAggregatorRoles(db, { log, budgetMs: verifyBudgetMs, feeds, blockedHosts });
  // Unreadable pages and failed fetches are recorded and retried; they do not fail the run.
  // An incomplete cycle (deferred roles, incomplete pagination) or lost writes do.
  return sweepResult.cycleComplete && sweepResult.writeFailures === 0;
}

let workdayResult: WorkdayRecheckResult | null = null;
let employerResult: EmployerConfirmResult | null = null;
// Set when the ATS stage starts; roles the board download stamped are at or after this.
let atsStartedAt: Date | null = null;

async function runEmployerConfirmation(): Promise<boolean> {
  log('Checking Greenhouse, Lever, and Ashby boards for closed jobs');
  employerResult = await confirmEmployerRoles(db, { log });
  // Failed boards, an incomplete role list, or writes that did not land mean some
  // roles were not checked even though the stage ran.
  return employerResult.clean;
}

/** Roles the list download did not touch are checked on their own Workday page. */
async function recheckMissedWorkday(): Promise<boolean> {
  // Small margin for clock skew between this runner and the database.
  const since = new Date((atsStartedAt ?? new Date(Date.now() - 45 * MINUTE)).getTime() - 5 * MINUTE);
  workdayResult = await recheckWorkdayRoles(db, { refreshedSince: since, log, budgetMs: 15 * MINUTE, blockedHosts: blockedWorkdayHosts });
  return workdayResult.clean;
}
function writeStepSummary(outcomes: StageOutcome[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ['## Launchpad sync', '', '| Stage | Group | Status | Seconds |', '| --- | --- | --- | --- |'];
  for (const o of outcomes) {
    lines.push(`| ${o.name} | ${o.group} | ${o.status}${o.error ? `: ${o.error.replace(/\|/g, '/')}` : ''} | ${(o.durationMs / 1000).toFixed(1)} |`);
  }
  if (atsResults.length) {
    const cell = (value: string) => value.replace(/\|/g, '/').replace(/[\r\n]/g, ' ');
    lines.push('', '### ATS company downloads', '',
      '| Employer | Coverage | Fetched | Eligible | New | Refreshed | Closed | Reason |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of atsResults) {
      const status = r.coverage?.status ?? (r.errors.length ? 'failed' : 'complete');
      const reason = [...r.errors, ...(r.coverage && r.coverage.status !== 'complete' ? [r.coverage.reason] : [])].join('; ');
      lines.push(`| ${cell(r.company)} | ${status} | ${r.fetched ?? 0} | ${r.candidates ?? 0} | ${r.imported} | ${r.updated} | ${r.closed} | ${cell(reason).slice(0, 500)} |`);
    }
  }
  if (ingestResults.length) {
    lines.push('', '### Aggregator feeds', '', '| Source | Coverage | Fetched | New | Refreshed | Closed | Errors | Stop reason |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of ingestResults) {
      lines.push(`| ${r.source} | ${r.coverage === 'complete' || r.coverage === 'disabled' ? r.coverage : r.coverage.toUpperCase()} | ${r.fetched} | ${r.rolesUpserted} | ${r.refreshed} | ${r.closed} | ${r.errors.length} | ${r.feedStopReason.replace(/\|/g, '/').slice(0, 300)} |`);
    }
  }
  if (workdayResult) {
    const w = workdayResult;
    const reasons = Object.entries(w.failureReasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(', ');
    lines.push(
      '', '### Workday page check', '',
      '| Candidates | Unmapped | Ineligible | Waiting on retry | Attempted | Verified | Closed | Unreadable | Failed | Blocked | Host-blocked skipped | Deferred | Write failures | Coverage |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      `| ${w.candidates} | ${w.unmapped} | ${w.ineligible} | ${w.waitingRetry} | ${w.attempted} | ${w.verified} | ${w.closed} | ${w.unreadable} | ${w.failed} | ${w.blocked} | ${w.hostBlockedSkipped} | ${w.deferred} | ${w.writeFailures} | ${w.coverage.complete ? 'complete' : `INCOMPLETE (${w.coverage.stopReason.replace(/\|/g, '/')})`} |`,
      '', `Failure reasons: ${reasons || 'none'}. Blocked hosts: ${w.blockedHosts.join(', ') || 'none'}.`,
      `Unmapped (left unverified): ${Object.entries(w.unmappedReasons).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => `${k} ${n}`).join('; ') || 'none'}.`,
    );
  }
  if (employerResult) {
    const e = employerResult;
    lines.push(
      '', '### Employer board confirmation', '',
      '| Roles scanned | Boards read | Boards failed | Confirmed | Closed | Ineligible | Skipped: unsupported URL | Skipped: unreadable board | Write failures | Coverage |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      `| ${e.rolesScanned} | ${e.boardsChecked} | ${e.boardsFailed} | ${e.confirmed} | ${e.closed} | ${e.ineligible} | ${e.skippedUnsupported} | ${e.skippedBoardFailed} | ${e.writeFailures} | ${e.coverage.complete ? 'complete' : `INCOMPLETE (${e.coverage.stopReason.replace(/\|/g, '/')})`} |`,
      '', `Failed boards: ${e.failedBoards.map((b) => `${b.provider}${b.region ? `(${b.region})` : ''} ${b.token} ${b.reason} (${b.roles} jobs)`).join('; ') || 'none'}.`,
      `Largest unsupported hosts (expected): ${e.unsupportedHosts.map((h) => `${h.host} ${h.roles}`).join(', ') || 'none'}.`,
    );
  }  if (sweepResult) {
    const s = sweepResult;
    lines.push(
      '', '### Aggregator verification', '',
      '| Eligible | Attempted | Recovery probes | Verified | Closed | Unreadable | Failed | Blocked | Host-blocked skipped | Deferred | Write failures | Backlog | Waiting on retry (start) | Waiting on retry (end) | Ineligible | Cycle complete |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      `| ${s.eligible} | ${s.attempted} | ${s.recoveryProbes} | ${s.verified} | ${s.closed} | ${s.unreadable} | ${s.failed} | ${s.blocked} | ${s.hostBlockedSkipped} | ${s.deferred} | ${s.writeFailures} | ${s.backlog} | ${s.retryWaitingAtStart} | ${s.retryScheduledAtEnd} | ${s.ineligible} | ${s.cycleComplete ? 'yes' : 'NO'} |`,
      '', `Pagination: ${s.pagination.pages} page(s), ${s.pagination.complete ? 'complete' : 'INCOMPLETE'} (${s.pagination.stopReason}).`,
      `Blocked hosts: ${s.blockedHosts.join(', ') || 'none'}. Recovered hosts: ${s.recoveredHosts.join(', ') || 'none'}` +
        `${s.retryCleared ? ` (${s.retryCleared} retry time(s) cleared for the next run)` : ''}.`,
      '', '| Feed | Host | Due | Waiting (start) | Attempted | Verified | Closed | Unreadable | Failed | Blocked | Host-blocked skipped | Deferred |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...s.bySource.map((b) =>
        `| ${b.feed} | ${b.host} | ${b.due} | ${b.waitingAtStart} | ${b.attempted} | ${b.verified} | ${b.closed} | ${b.unreadable} | ${b.failed} | ${b.blocked} | ${b.hostBlockedSkipped} | ${b.deferred} |`),
    );
  }
  try {
    appendFileSync(path, `${lines.join('\n')}\n`);
  } catch (error) {
    log(`Could not write job summary: ${errorMessage(error)}`);
  }
}

async function main(): Promise<void> {
  const started = Date.now();

  // Aggregators first and isolated: ingestion and verification are separate stages, so
  // a failed feed run still gets fallback verification, and nothing in the ATS group
  // (or its failure) can precede or block either.
  const stages: PipelineStage[] = [];
  if (!atsOnly) {
    stages.push(
      { name: 'aggregator-ingest', group: 'aggregators', run: runAggregatorIngest, timeoutMs: 40 * MINUTE },
      { name: 'aggregator-verify', group: 'aggregators', run: runAggregatorVerification, timeoutMs: verifyBudgetMs + 10 * MINUTE },
    );
  }
  if (!aggregatorsOnly) {
    stages.push(
      { name: 'ats-sync', group: 'ats', run: runAts, timeoutMs: 45 * MINUTE },
      { name: 'workday-recheck', group: 'ats', run: recheckMissedWorkday, timeoutMs: 20 * MINUTE },
      { name: 'employer-confirm', group: 'ats', run: runEmployerConfirmation, timeoutMs: 15 * MINUTE },
    );
  }

  const outcomes = await runStages(stages, log);
  writeStepSummary(outcomes);
  log(`Synchronization finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length) {
    log(`Stages not clean: ${failed.map((o) => `${o.name} (${o.status})`).join(', ')}. Skipped jobs are not verified.`);
    process.exitCode = 1;
  } else {
    log('Requested stages completed. Only jobs with evidence were refreshed.');
  }
}

main()
  .catch((error: unknown) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  })
  .finally(() => {
    // An abandoned (timed-out) stage may still hold sockets open; do not wait for it.
    process.exit(process.exitCode ?? 0);
  });
