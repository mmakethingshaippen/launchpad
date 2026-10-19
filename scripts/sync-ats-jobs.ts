/**
 * CLI ATS sync (Req 17.1). Runs the shared sync engine against the seed
 * companies (or, in future, companies loaded from the database) and prints a
 * per-company summary.
 *
 * Usage:
 *   npx tsx scripts/sync-ats-jobs.ts            # sync all seed companies
 *   npx tsx scripts/sync-ats-jobs.ts <slug>     # sync one company by slug
 */
import { SEED_COMPANIES } from '../src/data/seed-companies';
import { LocalStore } from '../src/lib/adapter/localStore.data';
import { syncAll } from '../src/lib/ats/sync';

async function main() {
  const slug = process.argv[2];
  const seed = slug ? SEED_COMPANIES.filter((c) => c.slug === slug) : SEED_COMPANIES;
  if (seed.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`No seed company with slug "${slug}"`);
    process.exit(1);
  }

  const store = new LocalStore(seed);
  const results = await syncAll(store.syncableCompanies(), store, {});

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
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
