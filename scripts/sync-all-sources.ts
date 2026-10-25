
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
      timeoutMs: 30_000,
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

async function main(): Promise<void> {
  const started = Date.now();
  let success = true;

  if (!aggregatorsOnly) {
    success = (await runAts()) && success;
  }

  if (!atsOnly) {
    success = (await runAggregators()) && success;
  }

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