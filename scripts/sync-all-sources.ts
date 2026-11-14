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
 * checked on their own page by sweepStaleAggregatorRoles (24h target interval).
 *
 * Optional environment:
 *   AGGREGATOR_VERIFY_BUDGET_MINUTES  time budget for fallback verification (default 45)
 *
 * Do not expose SUPABASE_SERVICE_ROLE_KEY to the browser or commit it.
 */
import { appendFileSync } from 'node:fs';
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../src/lib/ats/supabaseSink';
import { syncAll } from '../src/lib/ats/sync';
import { aggregatorRunSucceeded, ingestAggregators } from '../src/lib/ats/aggregators/ingest';
import { planEmployerConfirmation, type ConfirmableRole } from '../src/lib/ats/employerConfirm';
import { sweepStaleAggregatorRoles, type StaleSweepResult } from '../src/lib/ats/aggregators/staleSweep';
import { runStages, type PipelineStage, type StageOutcome } from '../src/lib/ats/pipeline';
import { parseWorkdayToken } from '../src/lib/ats/providers/workday';

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

function workdayDetailUrl(token: string, applyUrl: string): string | null {
  const coords = parseWorkdayToken(token);
  if (!coords) return null;
  try {
    const jobPath = new URL(applyUrl).pathname;
    const jobAt = jobPath.indexOf('/job/');
    if (jobAt < 0) return null;
    return `https://${coords.host}/wday/cxs/${encodeURIComponent(coords.tenant)}/${encodeURIComponent(coords.site)}${jobPath.slice(jobAt)}`;
  } catch {
    return null;
  }
}

const log = (message: string) =>
  console.log(`[${new Date().toISOString()}] ${message}`);

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function runAts(): Promise<boolean> {
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
      if (result.errors.length) {
        failures++;
        log(`ERROR ${result.company}: ${result.errors.join('; ')}`);
      }
    }

    log(`ATS ${Math.min(offset + 8, companies.length)}/${companies.length}`);
  }

  return failures === 0;
}

async function runAggregatorIngest(): Promise<boolean> {
  log('Importing and refreshing aggregator postings from a single fetch per source');

  const results = await ingestAggregators(db);

  for (const result of results) {
    log(
      `${result.source}: fetched ${result.fetched}; processed ${result.processed}; ` +
      `new ${result.rolesUpserted}; refreshed ${result.refreshed}; closed ${result.closed}; ` +
      `feedComplete ${result.feedComplete}; closeMissingEligible ${result.closeMissingEligible}` +
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

  return aggregatorRunSucceeded(results);
}

let sweepResult: StaleSweepResult | null = null;

async function runAggregatorVerification(): Promise<boolean> {
  log('Fallback verification of active aggregator roles the feeds did not observe');
  sweepResult = await sweepStaleAggregatorRoles(db, { log, budgetMs: verifyBudgetMs });
  // Unreadable pages and failed fetches are recorded and retried; they do not fail the run.
  // An incomplete cycle (deferred roles, incomplete pagination) or lost writes do.
  return sweepResult.cycleComplete && sweepResult.writeFailures === 0;
}

async function runEmployerConfirmation(): Promise<boolean> {
  log('Checking Greenhouse, Lever, and Ashby boards for closed jobs');
  const roles: ConfirmableRole[] = [];
  let after = '';

  for (;;) {
    let query = db.from('roles')
      .select('id,apply_url,companies(ats_provider,ats_board_token)')
      .eq('listing_status', 'Active')
      .order('id', { ascending: true })
      .limit(1000);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) {
      log(`ERROR employer check: ${error.message}`);
      return false;
    }
    const page = data ?? [];
    // Only an empty page ends the scan; a server row cap below 1000 returns short pages.
    if (page.length === 0) break;
    for (const row of page) {
      const company = Array.isArray(row.companies) ? row.companies[0] : row.companies;
      roles.push({
        id: String(row.id),
        applyUrl: typeof row.apply_url === 'string' ? row.apply_url : null,
        company: company ? {
          atsProvider: company.ats_provider as string | null,
          atsBoardToken: company.ats_board_token as string | null,
        } : null,
      });
    }
    after = String(page[page.length - 1].id);
  }

  const plan = await planEmployerConfirmation(roles);
  const now = new Date().toISOString();

  for (let offset = 0; offset < plan.closeIds.length; offset += 100) {
    const ids = plan.closeIds.slice(offset, offset + 100);
    const { error } = await db.from('roles').update({ listing_status: 'Closed' }).in('id', ids).eq('listing_status', 'Active');
    if (error) {
      log(`ERROR employer close: ${error.message}`);
      return false;
    }
  }

  for (let offset = 0; offset < plan.confirmIds.length; offset += 100) {
    const ids = plan.confirmIds.slice(offset, offset + 100);
    const { error } = await db.from('roles').update({ last_verified_at: now }).in('id', ids).eq('listing_status', 'Active');
    if (error) {
      log(`ERROR employer confirm: ${error.message}`);
      return false;
    }
  }

  log(
    `Employer check: boards ${plan.boardsChecked}; failed boards ${plan.boardsFailed}; ` +
    `confirmed open ${plan.confirmIds.length}; closed ${plan.closeIds.length}; skipped ${plan.skipped}`,
  );
  return true;
}

/** Roles the list download did not touch are checked on their own Workday page. */
async function recheckMissedWorkday(): Promise<boolean> {
  const cutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const { data: companies, error } = await db.from('companies')
    .select('id,ats_board_token')
    .eq('ats_provider', 'workday')
    .not('ats_board_token', 'is', null);
  if (error) {
    log(`ERROR workday recheck: ${error.message}`);
    return false;
  }
  const tokens = new Map<string, string>();
  for (const company of companies ?? []) {
    if (typeof company.ats_board_token === 'string') tokens.set(String(company.id), company.ats_board_token);
  }
  const companyIds = [...tokens.keys()];
  if (!companyIds.length) return true;

  const stale: Array<{ id: string; url: string }> = [];
  for (let index = 0; index < companyIds.length; index += 40) {
    const ids = companyIds.slice(index, index + 40);
    let after = '';
    for (;;) {
      let query = db.from('roles')
        .select('id,company_id,apply_url')
        .eq('listing_status', 'Active')
        .lt('last_verified_at', cutoff)
        .in('company_id', ids)
        .order('id', { ascending: true })
        .limit(1000);
      if (after) query = query.gt('id', after);
      const { data, error: roleError } = await query;
      if (roleError) {
        log(`ERROR workday recheck: ${roleError.message}`);
        return false;
      }
      const page = data ?? [];
      if (page.length === 0) break;
      for (const row of page) {
        const token = tokens.get(String(row.company_id));
        const applyUrl = typeof row.apply_url === 'string' ? row.apply_url : '';
        const detail = token ? workdayDetailUrl(token, applyUrl) : null;
        if (!detail) continue;
        stale.push({ id: String(row.id), url: detail });
      }
      after = String(page[page.length - 1].id);
    }
  }

  log(`Workday roles the list did not refresh: ${stale.length}`);
  let cursor = 0;
  let confirmed = 0;
  let closed = 0;
  let unread = 0;

  const workers = Array.from({ length: 8 }, async () => {
    for (;;) {
      const current = cursor;
      cursor += 1;
      const item = stale[current];
      if (!item) return;
      try {
        const response = await fetch(item.url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (response.status === 404 || response.status === 410) {
          closed += 1;
          const { error: closeError } = await db.from('roles')
            .update({ listing_status: 'Closed' })
            .eq('id', item.id)
            .eq('listing_status', 'Active');
          if (closeError) log(`ERROR workday close ${item.id}: ${closeError.message}`);
          continue;
        }
        if (!response.ok) {
          unread += 1;
          continue;
        }
        const body = await response.json() as { jobPostingInfo?: unknown };
        if (!body.jobPostingInfo) {
          unread += 1;
          continue;
        }
        confirmed += 1;
        const { error: stampError } = await db.from('roles')
          .update({ last_verified_at: new Date().toISOString() })
          .eq('id', item.id)
          .eq('listing_status', 'Active');
        if (stampError) log(`ERROR workday stamp ${item.id}: ${stampError.message}`);
      } catch {
        unread += 1;
      }
    }
  });
  await Promise.all(workers);
  log(`Workday page check: refreshed ${confirmed}; closed ${closed}; still unread ${unread}`);
  return true;
}

function writeStepSummary(outcomes: StageOutcome[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = ['## Launchpad sync', '', '| Stage | Group | Status | Seconds |', '| --- | --- | --- | --- |'];
  for (const o of outcomes) {
    lines.push(`| ${o.name} | ${o.group} | ${o.status}${o.error ? `: ${o.error.replace(/\|/g, '/')}` : ''} | ${(o.durationMs / 1000).toFixed(1)} |`);
  }
  if (sweepResult) {
    const s = sweepResult;
    lines.push(
      '', '### Aggregator verification', '',
      '| Eligible | Attempted | Verified | Closed | Unreadable | Failed | Deferred | Backlog | Waiting on retry | Cycle complete |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      `| ${s.eligible} | ${s.attempted} | ${s.verified} | ${s.closed} | ${s.unreadable} | ${s.failed} | ${s.deferred} | ${s.backlog} | ${s.waitingRetry} | ${s.cycleComplete ? 'yes' : 'NO'} |`,
      '', `Pagination: ${s.pagination.pages} page(s), ${s.pagination.complete ? 'complete' : 'INCOMPLETE'} (${s.pagination.stopReason}).`,
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
