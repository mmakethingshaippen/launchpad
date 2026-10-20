/**
 * Isolated connector / filter test runner.
 *
 * Runs a SINGLE ATS connector (or just the title filter) against its live public
 * JSON feed, pipes the results through our normalization + early-career filters,
 * and prints a clean summary — matched roles, rejected senior/recruiter titles,
 * and a few sample payloads. It never writes to Supabase or hammers every ATS.
 *
 * Usage:
 *   npm run test:connector simplify
 *   npm run test:connector greenhouse spacex
 *   npm run test:connector ashby anthropic
 *   npm run test:connector workday "amat.wd1.myworkdayjobs.com|amat|External"
 *   npm run test:connector amazon
 *   npm run test:connector title-filter "Software Engineer I, Backend"
 *
 * Providers accept a board token (2nd arg); aggregators ignore it.
 */
import type { NormalizedPosting, ProviderClient } from '../src/lib/ats/types';
import type { AggregatorClient } from '../src/lib/ats/aggregators/types';
import { createGreenhouseClient } from '../src/lib/ats/providers/greenhouse';
import { createAshbyClient } from '../src/lib/ats/providers/ashby';
import { createLeverClient } from '../src/lib/ats/providers/lever';
import { createSmartRecruitersClientFor } from '../src/lib/ats/providers/smartrecruiters';
import { createWorkableClient } from '../src/lib/ats/providers/workable';
import { createWorkdayClient } from '../src/lib/ats/providers/workday';
import { createSimplifyClient } from '../src/lib/ats/simplify';
import { createAmazonClient } from '../src/lib/ats/aggregators/amazon';
import { createTheMuseClient } from '../src/lib/ats/aggregators/themuse';
import { createRemotiveClient } from '../src/lib/ats/aggregators/remotive';
import { selectCandidates } from '../src/lib/ats/normalize';
import { isEarlyCareerTitle, matchEarlyCareerType } from '../src/lib/ats/classify';

/* eslint-disable no-console */

// Each provider factory takes the board token (smartrecruiters binds it; others
// receive it per-fetch but we keep the signature uniform).
const PROVIDERS: Record<string, (token: string) => ProviderClient> = {
  greenhouse: () => createGreenhouseClient() as ProviderClient,
  ashby: () => createAshbyClient() as ProviderClient,
  lever: () => createLeverClient() as ProviderClient,
  smartrecruiters: (token) => createSmartRecruitersClientFor(token) as ProviderClient,
  workable: () => createWorkableClient() as ProviderClient,
  workday: () => createWorkdayClient() as ProviderClient,
};

const AGGREGATORS: Record<string, () => AggregatorClient> = {
  simplify: () => createSimplifyClient(),
  amazon: () => createAmazonClient(),
  themuse: () => createTheMuseClient(),
  remotive: () => createRemotiveClient(),
};

function summarize(normalized: NormalizedPosting[]) {
  const total = normalized.length;
  const kept = selectCandidates(normalized);
  const rejected = normalized.filter((p) => !isEarlyCareerTitle(p.title));

  const byType = new Map<string, number>();
  for (const k of kept) byType.set(k.opportunityType, (byType.get(k.opportunityType) ?? 0) + 1);

  console.log(`\nFetched ${total} postings.`);
  console.log(`  ✓ kept (early-career, live):  ${kept.length}`);
  console.log(`  ✗ rejected by title filter:   ${rejected.length}`);
  console.log(`  (dropped by deadline/term/url: ${total - rejected.length - kept.length})`);
  console.log(
    '  opportunity types: ' +
      ([...byType.entries()].map(([t, n]) => `${t}=${n}`).join(', ') || '(none)'),
  );

  console.log('\nSample KEPT roles:');
  for (const k of kept.slice(0, 8)) {
    const loc = [k.city, k.state, k.country].filter(Boolean).join(', ') || k.workArrangement || '—';
    console.log(`  • [${k.opportunityType}] ${k.title}  — ${loc}`);
  }
  console.log('\nSample REJECTED titles:');
  for (const r of rejected.slice(0, 8)) console.log(`  • ${r.title}`);
}

async function runProvider(name: string, token: string | undefined) {
  if (!token) {
    console.error(`Provider "${name}" needs a board token, e.g. npm run test:connector ${name} <token>`);
    process.exit(1);
  }
  const client = PROVIDERS[name](token);
  console.log(`Running ${name} connector for token "${token}"…`);
  const raw = await client.fetchPostings(token, AbortSignal.timeout(25_000));
  const normalized = raw
    .map((r) => client.toNormalized(r))
    .filter((p): p is NormalizedPosting => p !== null);
  summarize(normalized);
}

async function runAggregator(name: string) {
  console.log(`Running ${name} aggregator feed…`);
  const client = AGGREGATORS[name]();
  const postings = await client.fetchEarlyCareer(AbortSignal.timeout(60_000));
  summarize(postings);
}

function runTitleFilter(title: string | undefined) {
  if (!title) {
    console.error('Usage: npm run test:connector title-filter "<job title>"');
    process.exit(1);
  }
  const matched = matchEarlyCareerType(title);
  console.log(`\nTitle: ${title}`);
  console.log(`  isEarlyCareerTitle: ${isEarlyCareerTitle(title)}`);
  console.log(`  opportunity type:   ${matched ?? '(rejected)'}`);
}

async function main() {
  const [name, arg] = process.argv.slice(2);
  if (!name) {
    console.error(
      'Usage: npm run test:connector <connector> [token|title]\n' +
        '  connectors: ' +
        [...Object.keys(PROVIDERS), ...Object.keys(AGGREGATORS), 'title-filter'].join(', '),
    );
    process.exit(1);
  }

  if (name === 'title-filter') return runTitleFilter(arg);
  if (AGGREGATORS[name]) return runAggregator(name);
  if (PROVIDERS[name]) return runProvider(name, arg);

  console.error(`Unknown connector "${name}".`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
