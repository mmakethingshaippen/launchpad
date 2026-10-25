/**
 * Run the Launchpad ATS and aggregator pipelines from a trusted server/runner.
 *
 * Locally:
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --aggregators-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts --ats-only
 *   npx tsx --env-file=.env scripts/sync-all-sources.ts
 *
 * Do not expose SUPABASE_SERVICE_ROLE_KEY to the browser or commit it.
 */
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../src/lib/ats/supabaseSink';
import { syncAll } from '../src/lib/ats/sync';
import { ingestAggregators } from '../src/lib/ats/aggregators/ingest';
import { createSimplifyClient } from '../src/lib/ats/simplify';
import { createAmazonClient } from '../src/lib/ats/aggregators/amazon';
import { createTheMuseClient } from '../src/lib/ats/aggregators/themuse';
import { createRemotiveClient } from '../src/lib/ats/aggregators/remotive';
import { createAdzunaClient } from '../src/lib/ats/aggregators/adzuna';
import { createUsaJobsClient } from '../src/lib/ats/aggregators/usajobs';
import type { AggregatorClient } from '../src/lib/ats/aggregators/types';
import { normalizeApplyUrl } from '../src/lib/ats/util';

const args = process.argv.slice(2);
const atsOnly = args.includes('--ats-only');
const aggregatorsOnly = args.includes('--aggregators-only');
if (atsOnly && aggregatorsOnly) throw new Error('Choose one of --ats-only or --aggregators-only.');

const db = createServiceClient();
const log = (message: string) => console.log(`[${new Date().toISOString()}] ${message}`);
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

type ExistingRole = { id: string; apply_url: string | null };

async function loadActiveAggregatorRoles(): Promise<ExistingRole[]> {
  const rows: ExistingRole[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = db.from('roles').select('id,apply_url')
      .eq('source', 'aggregator').eq('listing_status', 'Active')
      .order('id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Cannot list aggregator jobs: ${error.message}`);
    const page = (data ?? []) as ExistingRole[];
    if (!page.length) break;
    rows.push(...page);
    const next = page[page.length - 1].id;
    if (!next || next === cursor) throw new Error('Aggregator pagination stopped advancing.');
    cursor = next;
  }
  return rows;
}

async function refreshExistingAggregators(): Promise<boolean> {
  const roles = await loadActiveAggregatorRoles();
  const byUrl = new Map<string, string[]>();
  for (const role of roles) {
    if (!role.apply_url) continue;
    const key = normalizeApplyUrl(role.apply_url);
    byUrl.set(key, [...(byUrl.get(key) ?? []), role.id]);
  }

  const sources: AggregatorClient[] = [
    createSimplifyClient(), createAmazonClient(), createTheMuseClient(),
    createRemotiveClient(), createAdzunaClient(), createUsaJobsClient(),
  ];
  const matchedIds = new Set<string>();
  let failures = 0;
  for (const source of sources) {
    // These connectors currently have different completeness guarantees.
    // Only refresh URLs we actually observed; NEVER close absent jobs here.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const postings = await source.fetchEarlyCareer(controller.signal);
      let matched = 0;
      for (const posting of postings) {
        if (!posting.applyUrl) continue;
        for (const id of byUrl.get(normalizeApplyUrl(posting.applyUrl)) ?? []) {
          if (!matchedIds.has(id)) matched++;
          matchedIds.add(id);
        }
      }
      log(`${source.source}: ${postings.length} results, ${matched} existing roles matched`);
    } catch (error) {
      failures++;
      log(`ERROR ${source.source}: ${errorMessage(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  let refreshed = 0;
  const ids = [...matchedIds];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await db.from('roles')
      .update({ last_verified_at: new Date().toISOString() })
      .eq('source', 'aggregator').eq('listing_status', 'Active').in('id', batch);
    if (error) {
      failures++;
      log(`ERROR refreshing matched roles: ${error.message}`);
    } else {
      refreshed += batch.length;
    }
  }
  log(`Aggregator matches refreshed: ${refreshed}/${roles.length} active aggregator roles`);
  return failures === 0;
}

async function runAts(): Promise<boolean> {
  const companies = await loadSyncableCompanies(db);
  log(`Configured ATS companies: ${companies.length}`);
  let failures = 0;
  for (let offset = 0; offset < companies.length; offset += 8) {
    const batch = companies.slice(offset, offset + 8);
    const results = await syncAll(batch, new SupabaseSink(db), { concurrency: 4, timeoutMs: 30_000 });
    for (const r of results) {
      if (r.errors.length) {
        failures++;
        log(`ERROR ${r.company}: ${r.errors.join('; ')}`);
      }
    }
    log(`ATS ${Math.min(offset + 8, companies.length)}/${companies.length}`);
  }
  return failures === 0;
}

async function runAggregators(): Promise<boolean> {
  log('Importing available aggregator postings');
  const results = await ingestAggregators(db);
  let failures = 0;
  for (const result of results) {
    log(`${result.source}: ${result.rolesUpserted} roles written; ${result.errors.length} errors`);
    failures += result.errors.length;
    for (const e of result.errors.slice(0, 10)) log(`ERROR ${result.source}: ${e}`);
  }
  const refreshed = await refreshExistingAggregators();
  return failures === 0 && refreshed;
}

async function main() {
  let success = true;
  if (!aggregatorsOnly) success = (await runAts()) && success;
  if (!atsOnly) success = (await runAggregators()) && success;
  if (!success) {
    log('Some sources failed. Inspect logs; do not interpret skipped sources as verified.');
    process.exitCode = 1;
  } else {
    log('Requested stages completed. Only jobs observed in current feeds were refreshed.');
  }
}

main().catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
