/**
 * Verify live ATS endpoints BEFORE wiring anything into the seed.
 * Prints a status report (platform, HTTP status, job count). No secrets logged.
 *
 * Usage: npx tsx scripts/verify-endpoints.ts
 */

type Platform = 'greenhouse' | 'ashby' | 'lever' | 'workday';

interface Probe {
  name: string;
  platform: Platform;
  token: string; // greenhouse/ashby/lever board token, or workday "host|tenant|site"
}

const TIMEOUT = 10_000;

async function probeGreenhouse(token: string) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return { status: res.status, jobs: 0 };
  const data = (await res.json()) as { jobs?: unknown[] };
  return { status: res.status, jobs: data.jobs?.length ?? 0 };
}

async function probeAshby(token: string) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return { status: res.status, jobs: 0 };
  const data = (await res.json()) as { jobs?: unknown[] };
  return { status: res.status, jobs: data.jobs?.length ?? 0 };
}

async function probeLever(token: string) {
  const url = `https://api.lever.co/v0/postings/${token}?mode=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return { status: res.status, jobs: 0 };
  const data = (await res.json()) as unknown[];
  return { status: res.status, jobs: Array.isArray(data) ? data.length : 0 };
}

async function probeWorkday(spec: string) {
  // spec = "host|tenant|site"
  const [host, tenant, site] = spec.split('|');
  const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: 'intern' }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return { status: res.status, jobs: 0 };
  const data = (await res.json()) as { total?: number; jobPostings?: unknown[] };
  return { status: res.status, jobs: data.total ?? data.jobPostings?.length ?? 0 };
}

const PROBES: Probe[] = [
  // ── Greenhouse (Priority 2) ──
  ...(['stripe', 'databricks', 'airbnb', 'coinbase', 'doordash', 'figma', 'duolingo', 'anthropic',
    'scaleai', 'spacex', 'robinhood', 'affirm', 'chime', 'brex', 'gusto', 'pinterest', 'reddit',
    'cloudflare', 'lyft', 'instacart', 'waymo', 'janestreet', 'citadel', 'asana', 'hubspot', 'okta',
    'block', 'discord',
  ].map((t) => ({ name: t, platform: 'greenhouse' as const, token: t }))),

  // ── Ashby (Priority 3) ──
  ...(['openai', 'linear', 'notion', 'ramp', 'perplexity', 'elevenlabs', 'vanta', 'replit',
    'supabase', 'posthog', 'retool', 'deel', 'mercor', 'writer', 'sierra',
  ].map((t) => ({ name: t, platform: 'ashby' as const, token: t }))),

  // ── Lever (Priority 4) ──
  ...(['plaid', 'palantir', 'zoox', 'spotify', 'mistral', 'anduril', 'shieldai', 'netflix', 'ramp',
  ].map((t) => ({ name: t, platform: 'lever' as const, token: t }))),

  // ── Workday (Priority 1) — host|tenant|site guesses to verify ──
  { name: 'Workday', platform: 'workday', token: 'workday.wd5.myworkdayjobs.com|workday|Workday' },
  { name: 'Adobe', platform: 'workday', token: 'adobe.wd5.myworkdayjobs.com|adobe|external_experienced' },
  { name: 'Salesforce', platform: 'workday', token: 'salesforce.wd12.myworkdayjobs.com|salesforce|External_Career_Site' },
  { name: 'Nvidia', platform: 'workday', token: 'nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite' },
  { name: 'BofA', platform: 'workday', token: 'ghr.wd1.myworkdayjobs.com|ghr|Lateral-US' },
  { name: 'Citi', platform: 'workday', token: 'citi.wd5.myworkdayjobs.com|citi|2' },
  { name: 'MorganStanley', platform: 'workday', token: 'ms.wd5.myworkdayjobs.com|ms|External' },
  { name: 'BlackRock', platform: 'workday', token: 'blackrock.wd1.myworkdayjobs.com|blackrock|BlackRock_Professional' },
  { name: 'CapitalOne', platform: 'workday', token: 'capitalone.wd1.myworkdayjobs.com|capitalone|Capital_One' },
  { name: 'Mastercard', platform: 'workday', token: 'mastercard.wd1.myworkdayjobs.com|mastercard|CorporateCareers' },
  { name: 'Fidelity', platform: 'workday', token: 'wd1.myworkdaysite.com|fmr|FidelityCareers' },
  { name: 'CVSHealth', platform: 'workday', token: 'cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers' },
  { name: 'Target', platform: 'workday', token: 'target.wd5.myworkdayjobs.com|target|targetcareers' },
  { name: 'Walmart', platform: 'workday', token: 'walmart.wd5.myworkdayjobs.com|walmart|WalmartExternal' },
  { name: 'GE', platform: 'workday', token: 'ge.wd5.myworkdayjobs.com|ge|GE_ExternalSite' },
  { name: 'Intel', platform: 'workday', token: 'intel.wd1.myworkdayjobs.com|intel|External' },
  { name: 'Cisco', platform: 'workday', token: 'cisco.wd5.myworkdayjobs.com|cisco|Default' },
  { name: 'Dell', platform: 'workday', token: 'dell.wd1.myworkdayjobs.com|dell|External' },
  { name: 'HP', platform: 'workday', token: 'hp.wd5.myworkdayjobs.com|hp|ExternalCareerSite' },
  { name: 'Boeing', platform: 'workday', token: 'boeing.wd1.myworkdayjobs.com|boeing|External_Career_Site_US' },
  { name: 'WarnerBros', platform: 'workday', token: 'warnerbros.wd5.myworkdayjobs.com|warnerbros|global' },
  { name: 'Comcast', platform: 'workday', token: 'comcast.wd5.myworkdayjobs.com|comcast|Comcast_Careers' },
  { name: 'Puma', platform: 'workday', token: 'puma.wd3.myworkdayjobs.com|puma|PUMA' },
  { name: 'Unilever', platform: 'workday', token: 'unilever.wd3.myworkdayjobs.com|unilever|external' },
  { name: 'PwC', platform: 'workday', token: 'pwc.wd3.myworkdayjobs.com|pwc|Global_Experienced_Careers' },
  { name: 'Accenture', platform: 'workday', token: 'accenture.wd3.myworkdayjobs.com|accenture|AccentureCareers' },
  { name: 'Siemens', platform: 'workday', token: 'siemens.wd3.myworkdayjobs.com|siemens|siemens' },
];

async function run(p: Probe): Promise<{ name: string; platform: string; status: string; jobs: number }> {
  try {
    const r =
      p.platform === 'greenhouse'
        ? await probeGreenhouse(p.token)
        : p.platform === 'ashby'
          ? await probeAshby(p.token)
          : p.platform === 'lever'
            ? await probeLever(p.token)
            : await probeWorkday(p.token);
    return { name: p.name, platform: p.platform, status: String(r.status), jobs: r.jobs };
  } catch (e) {
    return { name: p.name, platform: p.platform, status: `ERR ${e instanceof Error ? e.message : e}`.slice(0, 40), jobs: 0 };
  }
}

async function main() {
  const results: Array<{ name: string; platform: string; status: string; jobs: number }> = [];
  // Bounded concurrency of 8.
  const queue = [...PROBES];
  async function worker() {
    while (queue.length) {
      const p = queue.shift()!;
      results.push(await run(p));
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  results.sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
  // eslint-disable-next-line no-console
  console.table(results);

  const ok = results.filter((r) => r.status === '200' && r.jobs > 0);
  const empty = results.filter((r) => r.status === '200' && r.jobs === 0);
  const bad = results.filter((r) => r.status !== '200');
  // eslint-disable-next-line no-console
  console.log(`\nReachable with jobs: ${ok.length} | 200 but 0 jobs: ${empty.length} | failing: ${bad.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
