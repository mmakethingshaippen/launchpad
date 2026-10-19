/**
 * Seed script.
 *
 * - With Supabase service credentials present (SUPABASE_URL / VITE_SUPABASE_URL
 *   + SUPABASE_SERVICE_ROLE_KEY): upserts the seed companies + locations into
 *   the live database as Approved records. Idempotent (matched by slug).
 *   Never fabricates roles — roles are ingested separately by the sync script.
 *
 * - Without credentials: runs a dry-run that fetches every seed company's ATS
 *   feed and reports reachability / open early-career role counts.
 *
 * Load env with Node's native flag:  node --env-file=.env (or `npm run seed`).
 *
 * Usage:  npx tsx scripts/sync-ats-jobs.ts   (run AFTER seeding to ingest roles)
 */
import { SEED_COMPANIES } from '../src/data/seed-companies';
import { createGreenhouseClient } from '../src/lib/ats/providers/greenhouse';
import { createAshbyClient } from '../src/lib/ats/providers/ashby';
import { createLeverClient } from '../src/lib/ats/providers/lever';
import { selectCandidates } from '../src/lib/ats/normalize';
import type { ProviderClient } from '../src/lib/ats/types';
import { createServiceClient, seedCompanies } from '../src/lib/ats/supabaseSink';

function hasServiceCreds(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function clientFor(provider: string): ProviderClient | null {
  if (provider === 'greenhouse') return createGreenhouseClient() as ProviderClient;
  if (provider === 'ashby') return createAshbyClient() as ProviderClient;
  if (provider === 'lever') return createLeverClient() as ProviderClient;
  return null;
}

async function seedToDatabase() {
  // eslint-disable-next-line no-console
  console.log(`Seeding ${SEED_COMPANIES.length} companies into Supabase…`);
  const db = createServiceClient();
  const report = await seedCompanies(db, SEED_COMPANIES);
  // eslint-disable-next-line no-console
  console.table(report);
  const errors = report.filter((r) => r.status === 'error');
  const inserted = report.filter((r) => r.status === 'inserted').length;
  const updated = report.filter((r) => r.status === 'updated').length;
  // eslint-disable-next-line no-console
  console.log(`\nSeed complete: ${inserted} inserted, ${updated} updated, ${errors.length} errors.`);
  if (errors.length) {
    // eslint-disable-next-line no-console
    console.warn('Errors:', errors.map((e) => `${e.name}: ${e.message}`).join('\n  '));
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log('\nNext: run `npm run sync` to ingest live roles from ATS feeds.');
}

async function dryRun() {
  // eslint-disable-next-line no-console
  console.log('No Supabase service credentials found — running ATS token verification (dry-run).\n');
  const report: Array<{ name: string; token: string | null; provider: string; status: string; roles: number }> = [];

  for (const company of SEED_COMPANIES) {
    const client = clientFor(company.atsProvider);
    if (!client || !company.atsBoardToken) {
      report.push({ name: company.name, token: company.atsBoardToken, provider: company.atsProvider, status: 'no-ats', roles: 0 });
      continue;
    }
    try {
      const raw = await client.fetchPostings(company.atsBoardToken, AbortSignal.timeout(10_000));
      const normalized = raw
        .map((r) => client.toNormalized(r))
        .filter((p): p is NonNullable<typeof p> => p !== null);
      const candidates = selectCandidates(normalized);
      report.push({ name: company.name, token: company.atsBoardToken, provider: company.atsProvider, status: 'ok', roles: candidates.length });
    } catch (err) {
      report.push({
        name: company.name,
        token: company.atsBoardToken,
        provider: company.atsProvider,
        status: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        roles: 0,
      });
    }
  }

  const bad = report.filter((r) => r.status.startsWith('ERROR'));
  // eslint-disable-next-line no-console
  console.table(report);
  // eslint-disable-next-line no-console
  console.log(
    `\nSeed verification complete: ${report.length} companies, ` +
      `${report.filter((r) => r.status === 'ok').length} reachable, ${bad.length} failing tokens.`,
  );
  if (bad.length) {
    // eslint-disable-next-line no-console
    console.warn('Tokens needing correction:', bad.map((b) => `${b.name} (${b.token})`).join(', '));
  }
}

async function main() {
  if (hasServiceCreds()) {
    await seedToDatabase();
  } else {
    await dryRun();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
