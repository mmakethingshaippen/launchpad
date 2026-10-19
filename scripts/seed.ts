/**
 * Seed verification + (optional) DB seed.
 *
 * Dry-run (default): validates every seed company's ATS board token by issuing
 * a live fetch and reports which tokens return non-200 or no early-career roles.
 * NEVER fabricates a fallback role.
 *
 * With DATABASE_URL / Supabase service creds (future wiring), it would insert
 * approved companies + locations and run syncAll to populate real roles.
 *
 * Usage:  npx tsx scripts/seed.ts          # dry-run token verification
 */
import { SEED_COMPANIES } from '../src/data/seed-companies';
import { createGreenhouseClient } from '../src/lib/ats/providers/greenhouse';
import { createAshbyClient } from '../src/lib/ats/providers/ashby';
import { createLeverClient } from '../src/lib/ats/providers/lever';
import { selectCandidates } from '../src/lib/ats/normalize';
import type { ProviderClient } from '../src/lib/ats/types';

function clientFor(provider: string): ProviderClient | null {
  if (provider === 'greenhouse') return createGreenhouseClient() as ProviderClient;
  if (provider === 'ashby') return createAshbyClient() as ProviderClient;
  if (provider === 'lever') return createLeverClient() as ProviderClient;
  return null;
}

async function main() {
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
      report.push({
        name: company.name,
        token: company.atsBoardToken,
        provider: company.atsProvider,
        status: 'ok',
        roles: candidates.length,
      });
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

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
