/// <reference types="node" />

/**
 * Run the Launchpad ATS and aggregator pipelines from a trusted server/runner.
 *
 * Locally:
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --aggregators-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --ats-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts
 *
 * Aggregator feeds are downloaded once inside ingestAggregators. That pass
 * inserts new rows and refreshes verification timestamps for listings it
 * actually saw. It does not fetch the feeds again.
 *
 * Do not expose SUPABASE_SERVICE_ROLE_KEY to the browser or commit it.
 */
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../src/lib/ats/supabaseSink';
import { syncAll } from '../src/lib/ats/sync';
import { aggregatorRunSucceeded, ingestAggregators } from '../src/lib/ats/aggregators/ingest';
import { planEmployerConfirmation, type ConfirmableRole } from '../src/lib/ats/employerConfirm';

const args = process.argv.slice(2);
const atsOnly = args.includes('--ats-only');
const aggregatorsOnly = args.includes('--aggregators-only');

if (atsOnly && aggregatorsOnly) {
  throw new Error('Choose one of --ats-only or --aggregators-only.');
}

const db = createServiceClient();

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

async function runAggregators(): Promise<boolean> {
  log('Importing and refreshing aggregator postings from a single fetch per source');

  const results = await ingestAggregators(db);

  for (const result of results) {
    log(
      `${result.source}: fetched ${result.fetched}; processed ${result.processed}; ` +
      `new ${result.rolesUpserted}; refreshed ${result.refreshed}; ` +
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
    'Unobserved jobs were not closed or re-stamped.',
  );

  return aggregatorRunSucceeded(results);
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
    if (page.length < 1000) break;
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

const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/** Drop imported listings the daily run has not confirmed in two days. */
async function closeUnverifiedRoles(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  let closed = 0;

  for (;;) {
    const { data, error } = await db.from('roles')
      .select('id')
      .eq('listing_status', 'Active')
      .in('source', ['ats', 'aggregator'])
      .lt('last_verified_at', cutoff)
      .limit(500);
    if (error) {
      log(`ERROR stale close: ${error.message}`);
      return;
    }
    const ids = (data ?? []).map((row) => String(row.id));
    if (!ids.length) break;
    const { error: updateError } = await db.from('roles')
      .update({ listing_status: 'Closed' })
      .in('id', ids)
      .eq('listing_status', 'Active');
    if (updateError) {
      log(`ERROR stale close: ${updateError.message}`);
      return;
    }
    closed += ids.length;
    if (ids.length < 500) break;
  }

  log(`Closed ${closed} listings not verified since ${cutoff}.`);
}

async function main(): Promise<void> {
  const started = Date.now();
  let success = true;

  if (!aggregatorsOnly) {
    success = (await runAts()) && success;
  }

  if (!atsOnly) {
    success = (await runAggregators()) && success;
  }

  success = (await runEmployerConfirmation()) && success;
  await closeUnverifiedRoles();

  log(`Synchronization finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  if (!success) {
    log('Some sources failed. Inspect logs; skipped jobs are not verified.');
    process.exitCode = 1;
  } else {
    log(
      'Requested stages completed. Only jobs observed in current feeds were refreshed.',
    );
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});