/**
 * CLI ATS sync (Req 17.1). Runs the shared sync engine and prints a per-company
 * summary.
 *
 * - With Supabase service credentials: loads approved, ATS-enabled companies
 *   from the database and writes live roles through the SupabaseSink
 *   (upsert by (company_id, external_job_id); auto-closes roles dropped from feeds).
 * - Without credentials: runs against an in-memory LocalStore of the seed
 *   companies (no persistence) so the engine can still be exercised offline.
 *
 * Load env with Node's native flag:  node --env-file=.env (or `npm run sync`).
 *
 * Usage:
 *   npm run sync                 # sync all companies
 *   npm run sync -- <slug>       # sync one company by slug
 */
import { SEED_COMPANIES } from '../src/data/seed-companies';
import { LocalStore } from '../src/lib/adapter/localStore.data';
import { syncAll, type SyncResult } from '../src/lib/ats/sync';
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../src/lib/ats/supabaseSink';

function hasServiceCreds(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

async function runCloud(slug?: string): Promise<SyncResult[]> {
  const db = createServiceClient();
  const companies = await loadSyncableCompanies(db, slug);
  if (companies.length === 0) {
    // eslint-disable-next-line no-console
    console.error(
      slug
        ? `No ATS-enabled company with slug "${slug}" in the database. Did you run \`npm run seed\` first?`
        : 'No ATS-enabled companies in the database. Run `npm run seed` first.',
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`Syncing ${companies.length} companies into Supabase…`);
  return syncAll(companies, new SupabaseSink(db), {});
}

async function runLocal(slug?: string): Promise<SyncResult[]> {
  const seed = slug ? SEED_COMPANIES.filter((c) => c.slug === slug) : SEED_COMPANIES;
  if (seed.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`No seed company with slug "${slug}"`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('No Supabase service credentials — running in-memory (no persistence).');
  const store = new LocalStore(seed);
  return syncAll(store.syncableCompanies(), store, {});
}

async function main() {
  const slug = process.argv[2];
  const results = hasServiceCreds() ? await runCloud(slug) : await runLocal(slug);

  // eslint-disable-next-line no-console
  console.table(
    results.map((r) => ({
      company: r.company,
      imported: r.imported,
      updated: r.updated,
      closed: r.closed,
      errors: r.errors.length,
    })),
  );
  const totals = results.reduce(
    (acc, r) => ({
      imported: acc.imported + r.imported,
      updated: acc.updated + r.updated,
      closed: acc.closed + r.closed,
    }),
    { imported: 0, updated: 0, closed: 0 },
  );
  // eslint-disable-next-line no-console
  console.log(`\nTotals — imported ${totals.imported}, updated ${totals.updated}, closed ${totals.closed}`);
  const withErrors = results.filter((r) => r.errors.length);
  if (withErrors.length) {
    // eslint-disable-next-line no-console
    console.warn(`\n${withErrors.length} companies had errors:`);
    for (const r of withErrors) {
      // eslint-disable-next-line no-console
      console.warn(`  ${r.company}: ${r.errors.join('; ')}`);
    }
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
