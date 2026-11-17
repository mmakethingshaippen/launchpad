// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isFreshlyVerified } from '../../freshness';
import {
  judgePage,
  nextRetryAt,
  sweepStaleAggregatorRoles,
  verificationCutoff,
} from './staleSweep';

type Row = Record<string, unknown> & { id: string };

const NOW = new Date('2026-11-13T12:00:00Z');
const OLD = '2026-10-29T00:00:00Z';
const HOURS = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

interface FakeOptions {
  /** PostgREST-style cap: pages never exceed this, whatever limit is requested. */
  maxRows?: number;
  /** Return an error for an update to a role when this returns a message. */
  failUpdate?: (id: string, patch: Row) => string | null;
  /** Updates to these ids silently match no row. */
  zeroRowIds?: string[];
  failRunInsert?: boolean;
  /** The runs table lacks the 0008 columns: updates that include them fail like PostgREST would. */
  missingRunColumns?: boolean;
  /** 1-based roles select request number that returns a database error. */
  failSelectAtRequest?: number;
}

function createDb(roles: Row[], options: FakeOptions = {}) {
  const updates: Array<{ id: string; patch: Row }> = [];
  const runs: Row[] = [];
  const pageRequests: Array<{ after: string; limit: number }> = [];

  function from(table: string) {
    const op = {
      action: 'select' as 'select' | 'update' | 'insert',
      payload: {} as Row,
      filters: [] as Array<{ type: 'eq' | 'gt' | 'lt' | 'in' | 'or'; col: string; val: unknown }>,
      limit: 1000,
    };
    const builder = {
      select() { return builder; },
      single() { return builder; },
      insert(payload: Row) { op.action = 'insert'; op.payload = payload; return builder; },
      update(payload: Row) { op.action = 'update'; op.payload = payload; return builder; },
      eq(col: string, val: unknown) { op.filters.push({ type: 'eq', col, val }); return builder; },
      gt(col: string, val: unknown) { op.filters.push({ type: 'gt', col, val }); return builder; },
      lt(col: string, val: unknown) { op.filters.push({ type: 'lt', col, val }); return builder; },
      in(col: string, val: unknown) { op.filters.push({ type: 'in', col, val }); return builder; },
      or(expr: string) { op.filters.push({ type: 'or', col: '', val: expr }); return builder; },
      order() { return builder; },
      limit(n: number) { op.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    function matchesOr(row: Row, expr: string) {
      return expr.split(/,(?=[a-z_]+\.)/).some((clause) => {
        const [col, operator, ...rest] = clause.split('.');
        const value = rest.join('.');
        if (operator === 'is' && value === 'null') return row[col] === null || row[col] === undefined;
        if (operator === 'lt') return row[col] !== null && row[col] !== undefined && String(row[col]) < value;
        throw new Error(`unsupported or clause ${clause}`);
      });
    }
    function matches(row: Row) {
      return op.filters.every((f) => {
        if (f.type === 'eq') return row[f.col] === f.val;
        if (f.type === 'gt') return String(row[f.col]) > String(f.val);
        if (f.type === 'in') return (f.val as unknown[]).includes(row[f.col]);
        // SQL semantics: NULL < x is not true.
        if (f.type === 'lt') return row[f.col] !== null && row[f.col] !== undefined && String(row[f.col]) < String(f.val);
        return matchesOr(row, String(f.val));
      });
    }
    function run() {
      if (table === 'aggregator_verification_runs') {
        if (op.action === 'insert') {
          if (options.failRunInsert) return { data: null, error: { message: 'runs table unavailable' } };
          const row = { ...op.payload, id: `run-${runs.length + 1}` };
          runs.push(row);
          return { data: { id: row.id }, error: null };
        }
        if (options.missingRunColumns && 'blocked' in op.payload) {
          return { data: null, error: { message: "Could not find the 'blocked' column of 'aggregator_verification_runs' in the schema cache" } };
        }
        const hit = runs.find((r) => r.id === op.filters.find((f) => f.col === 'id')?.val);
        if (hit) Object.assign(hit, op.payload);
        return { data: null, error: null };
      }
      if (table !== 'roles') throw new Error(`unexpected table ${table}`);
      const hits = roles.filter(matches);
      if (op.action === 'select') {
        const after = String(op.filters.find((f) => f.type === 'gt')?.val ?? '');
        pageRequests.push({ after, limit: op.limit });
        if (options.failSelectAtRequest === pageRequests.length) return { data: null, error: { message: 'boom' } };
        const cap = Math.min(op.limit, options.maxRows ?? Number.POSITIVE_INFINITY);
        return { data: hits.sort((a, b) => a.id.localeCompare(b.id)).slice(0, cap), error: null };
      }
      const written: Array<{ id: string }> = [];
      for (const row of hits) {
        const failure = options.failUpdate?.(row.id, op.payload) ?? null;
        if (failure) return { data: null, error: { message: failure } };
        if (options.zeroRowIds?.includes(row.id)) continue;
        Object.assign(row, op.payload);
        updates.push({ id: row.id, patch: op.payload });
        written.push({ id: row.id });
      }
      return { data: written, error: null };
    }
    return builder;
  }
  return { db: { from } as unknown as SupabaseClient, updates, runs, pageRequests };
}

function role(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    title: 'HR Operations Lifecycle Intern',
    apply_url: `https://jobs.example.test/${id}`,
    source: 'aggregator',
    listing_status: 'Active',
    last_verified_at: OLD,
    last_verification_attempt_at: null,
    verification_failure_count: 0,
    next_verification_at: null,
    ...overrides,
  };
}

const FILLER = '<p>Apply now. Responsibilities, benefits and team details follow here.</p>'.repeat(20);
const LIVE_HTML = `<html><head><title>HR Operations Lifecycle Intern - Example</title></head><body><h1>HR Operations Lifecycle Intern</h1>${FILLER}</body></html>`;

function htmlResponse(status: number, body: string, url = '', headers: Record<string, string> = {}) {
  const response = new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
  if (url) {
    Object.defineProperty(response, 'url', { value: url });
  }
  return response;
}

const liveFetch = (async () => htmlResponse(200, LIVE_HTML)) as unknown as typeof fetch;

describe('verification eligibility (24h target with scheduler jitter)', () => {
  it('uses a cutoff earlier than 24h so a slightly early daily run does not skip a job for 48h', () => {
    expect(NOW.getTime() - verificationCutoff(NOW).getTime()).toBeLessThan(24 * 3_600_000);
  });

  it('checks jobs verified 25h and 23h50m ago, and leaves one verified 10h ago alone', async () => {
    const roles = [
      role('due-25h', { last_verified_at: HOURS(25) }),
      role('due-narrow-miss', { last_verified_at: HOURS(23.8) }),
      role('fresh', { last_verified_at: HOURS(10) }),
    ];
    const fake = createDb(roles);
    const fetched: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async (url: string) => { fetched.push(String(url)); return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch,
    });
    expect(fetched.sort()).toEqual([
      'https://jobs.example.test/due-25h',
      'https://jobs.example.test/due-narrow-miss',
    ]);
    expect(result).toMatchObject({ eligible: 2, attempted: 2, verified: 2, backlog: 0, cycleComplete: true });
    expect(roles[2].last_verified_at).toBe(HOURS(10));
  });

  it('includes never-verified (NULL last_verified_at) roles', async () => {
    const roles = [role('never', { last_verified_at: null })];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(result).toMatchObject({ eligible: 1, verified: 1 });
    expect(roles[0].last_verified_at).toBe(NOW.toISOString());
  });

  it('skips closed rows and non-aggregator rows', async () => {
    const roles = [role('closed', { listing_status: 'Closed' }), role('ats', { source: 'ats' })];
    const fake = createDb(roles);
    let fetched = 0;
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async () => { fetched += 1; return htmlResponse(404, ''); }) as unknown as typeof fetch,
    });
    expect(fetched).toBe(0);
    expect(result.eligible).toBe(0);
  });
});

describe('database pagination', () => {
  it('reads every page when the server returns fewer rows than the requested limit', async () => {
    const roles = Array.from({ length: 8 }, (_, i) => role(`r${i}`, { last_verified_at: i % 2 ? null : OLD }));
    const fake = createDb(roles, { maxRows: 3 });
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    // The old "short page means last page" rule would have stopped after 3 rows.
    expect(result.eligible).toBe(8);
    expect(result.verified).toBe(8);
    expect(result.pagination).toMatchObject({ complete: true, pages: 3 });
    expect(roles.every((r) => r.last_verified_at === NOW.toISOString())).toBe(true);
  });

  it('reports incomplete pagination, and an incomplete cycle, when a later page read fails', async () => {
    const roles = Array.from({ length: 4 }, (_, i) => role('r' + i));
    const fake = createDb(roles, { maxRows: 2, failSelectAtRequest: 2 });
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(result.pagination.complete).toBe(false);
    expect(result.pagination.stopReason).toMatch(/boom/);
    expect(result.cycleComplete).toBe(false);
    // Rows read before the failure are still verified; the rest stay stale for the next run.
    expect(result.verified).toBe(2);
  });
});
describe('time budget and continuation', () => {
  it('persists progress so a later run resumes the deferred roles first and does not repeat finished ones', async () => {
    const roles = Array.from({ length: 6 }, (_, i) => role(`r${i}`));
    const fake = createDb(roles);
    const fetched: string[] = [];
    const fetchImpl = (async (url: string) => { fetched.push(String(url)); return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch;

    // Each clock read advances 10ms; the budget allows only part of the queue.
    let ticks = 0;
    const first = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, fetchImpl, concurrency: 1, budgetMs: 25, clock: () => (ticks += 10),
    });
    expect(first.attempted).toBeGreaterThan(0);
    expect(first.deferred).toBeGreaterThan(0);
    expect(first.attempted + first.deferred).toBe(6);
    expect(first.cycleComplete).toBe(false);
    expect(first.backlog).toBe(first.deferred);
    expect(fake.runs[0]).toMatchObject({ status: 'incomplete', deferred: first.deferred, cycle_complete: false });

    const firstRun = [...fetched];
    fetched.length = 0;
    const second = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl, concurrency: 1 });
    // Verified roles are fresh now; only the deferred ones remain, and none is checked twice.
    expect(second.eligible).toBe(first.deferred);
    expect(second.cycleComplete).toBe(true);
    expect(new Set([...firstRun, ...fetched]).size).toBe(6);
    expect(fetched.length + firstRun.length).toBe(6);
  });

  it('puts never-attempted roles ahead of ones already tried and still unverified', async () => {
    const roles = [
      role('tried', { last_verification_attempt_at: HOURS(1), verification_failure_count: 1, next_verification_at: null }),
      role('untouched'),
    ];
    const fake = createDb(roles);
    const order: string[] = [];
    await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, concurrency: 1,
      fetchImpl: (async (url: string) => { order.push(String(url).split('/').pop()!); return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch,
    });
    expect(order).toEqual(['untouched', 'tried']);
  });
});

describe('unverified outcomes stay unverified', () => {
  it('records timeouts, 403/429/500 and unreadable pages separately and never touches last_verified_at', async () => {
    const ids = ['timeout', '403', '429', '500', 'soft', 'empty', 'badurl'];
    const roles = ids.map((id) => role(id, id === 'badurl' ? { apply_url: 'ftp://x' } : {}));
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async (url: string) => {
        const u = String(url);
        if (u.endsWith('/timeout')) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        if (u.endsWith('/403')) return htmlResponse(403, 'denied');
        if (u.endsWith('/429')) return htmlResponse(429, 'slow down');
        if (u.endsWith('/500')) return htmlResponse(500, 'oops');
        if (u.endsWith('/soft')) return htmlResponse(200, `<html>${'x '.repeat(400)}This job is no longer available.</html>`);
        return htmlResponse(200, '<html></html>');
      }) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ verified: 0, closed: 0, failed: 4, unreadable: 3, attempted: 7, backlog: 7 });
    for (const row of roles) {
      expect(row.last_verified_at).toBe(OLD);
      expect(row.listing_status).toBe('Active');
      expect(row.last_verification_attempt_at).toBe(NOW.toISOString());
      expect(row.last_verification_failure_reason).toBeTruthy();
      expect(row.verification_failure_count).toBe(1);
      expect(Date.parse(String(row.next_verification_at))).toBeGreaterThan(NOW.getTime());
    }
    expect(roles.find((r) => r.id === 'timeout')?.last_verification_failure_reason).toBe('timeout');
    expect(roles.find((r) => r.id === '429')?.last_verification_failure_reason).toBe('http-429');
    for (const update of fake.updates) expect(update.patch).not.toHaveProperty('last_verified_at');
  });

  it('retries a failed role only after its retry time, with growing backoff', async () => {
    const roles = [role('flaky')];
    const fake = createDb(roles);
    const down = (async () => htmlResponse(503, 'down')) as unknown as typeof fetch;
    await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: down });
    expect(roles[0].verification_failure_count).toBe(1);

    const tooSoon = await sweepStaleAggregatorRoles(fake.db, { now: new Date(NOW.getTime() + 3_600_000), fetchImpl: down });
    expect(tooSoon).toMatchObject({ eligible: 0, waitingRetry: 1, attempted: 0 });

    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    await sweepStaleAggregatorRoles(fake.db, { now: later, fetchImpl: down });
    expect(roles[0].verification_failure_count).toBe(2);
    expect(nextRetryAt(NOW, 2).getTime() - NOW.getTime()).toBeGreaterThan(nextRetryAt(NOW, 1).getTime() - NOW.getTime());
    expect(roles[0].last_verified_at).toBe(OLD);
  });

  it('clears failure state when evidence is later found', async () => {
    const roles = [role('recovers', { verification_failure_count: 2, last_verification_failure_reason: 'timeout' })];
    const fake = createDb(roles);
    await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(roles[0]).toMatchObject({
      last_verified_at: NOW.toISOString(),
      verification_failure_count: 0,
      last_verification_failure_reason: null,
      next_verification_at: null,
    });
  });
});

describe('closing', () => {
  it('closes on an explicit 404 or 410 and leaves last_verified_at as it was', async () => {
    const roles = [role('a'), role('b')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async (url: string) => htmlResponse(String(url).endsWith('/a') ? 404 : 410, 'gone')) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ closed: 2, verified: 0, failed: 0, unreadable: 0 });
    expect(roles.map((r) => r.listing_status)).toEqual(['Closed', 'Closed']);
    expect(roles.every((r) => r.last_verified_at === OLD)).toBe(true);
  });

  it('does not close when a redirect to a generic page ends in 404', async () => {
    const roles = [role('moved')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async () => htmlResponse(404, 'not found', 'https://jobs.example.test/careers')) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ closed: 0, unreadable: 1 });
    expect(roles[0].listing_status).toBe('Active');
    expect(roles[0].last_verified_at).toBe(OLD);
  });
});

describe('failed writes are not reported as success', () => {
  it('does not count a verification whose write errored, and leaves last_verified_at alone', async () => {
    const roles = [role('a'), role('b')];
    const fake = createDb(roles, { failUpdate: (id) => (id === 'a' ? 'write rejected' : null) });
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(result).toMatchObject({ verified: 1, failed: 1, writeFailures: 1, backlog: 1 });
    expect(roles[0].last_verified_at).toBe(OLD);
    expect(roles[1].last_verified_at).toBe(NOW.toISOString());
    expect(result.cycleComplete).toBe(true); // everything was attempted; the lost write is in writeFailures
  });

  it('does not count a close that matched no row', async () => {
    const roles = [role('gone')];
    const fake = createDb(roles, { zeroRowIds: ['gone'] });
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async () => htmlResponse(404, 'gone')) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ closed: 0, failed: 1, writeFailures: 1 });
  });

  it('still verifies when the run-summary table is unavailable, and says the summary was not persisted', async () => {
    const roles = [role('a')];
    const fake = createDb(roles, { failRunInsert: true });
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(result.verified).toBe(1);
    expect(result.summaryPersisted).toBe(false);
  });
});

describe('page evidence (judgePage)', () => {
  const role = { title: 'HR Operations Lifecycle Intern', companyName: 'Example Corp' };
  const base = { contentType: 'text/html', role, requestedUrl: 'https://jobs.example.test/roles/1' };
  const jsonLd = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
  const page = (inner: string) => `<html><head></head><body>${inner}${FILLER}</body></html>`;

  it('accepts a matching JobPosting', () => {
    const body = page(jsonLd({ '@type': 'JobPosting', title: 'HR Operations Lifecycle Intern', hiringOrganization: { name: 'Example Corp Inc.' } }));
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'live' });
  });

  it('rejects a page whose only JobPosting is for a different job', () => {
    const body = page(`<h1>HR Operations Lifecycle Intern</h1>${jsonLd({ '@type': 'JobPosting', title: 'Staff Plumber' })}`);
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'unreadable', reason: 'unrelated-jobposting' });
  });

  it('rejects a matching title that belongs to another employer', () => {
    const body = page(jsonLd({ '@type': 'JobPosting', title: 'HR Operations Lifecycle Intern', hiringOrganization: { name: 'Other Co' } }));
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'unreadable' });
  });

  it('rejects an expired JobPosting', () => {
    const body = page(jsonLd({ '@type': 'JobPosting', title: 'HR Operations Lifecycle Intern', validThrough: '2020-01-01' }));
    expect(judgePage({ ...base, status: 200, body, now: NOW })).toMatchObject({ verdict: 'unreadable', reason: 'jobposting-expired' });
  });

  it('rejects the title appearing only in a recommended-jobs list', () => {
    const body = page('<h1>Software Engineer</h1><h2>Recommended jobs</h2><ul><li><a href="/x">HR Operations Lifecycle Intern</a></li></ul>');
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'unreadable', reason: 'no-role-evidence' });
  });

  it('rejects a search results page that lists the title', () => {
    const body = page('<h1>Search results: 214 jobs</h1><a href="/r/1">HR Operations Lifecycle Intern</a>');
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'unreadable' });
  });

  it('rejects a login page', () => {
    const body = page('<title>HR Operations Lifecycle Intern</title><form><input type="password" name="p"></form>');
    expect(judgePage({ ...base, status: 200, body })).toMatchObject({ verdict: 'unreadable', reason: 'login-page' });
  });

  it('rejects a generic redirect even when the destination page is full of matching text', () => {
    expect(judgePage({ ...base, status: 200, body: LIVE_HTML, finalUrl: 'https://jobs.example.test/careers' }))
      .toMatchObject({ verdict: 'unreadable', reason: 'generic-redirect' });
    expect(judgePage({ ...base, status: 200, body: LIVE_HTML, finalUrl: 'https://sso.example.test/login?next=1' }))
      .toMatchObject({ verdict: 'unreadable', reason: 'generic-redirect' });
  });

  it('treats a heading match on the same URL (http to https, trailing slash) as evidence', () => {
    expect(judgePage({ ...base, status: 200, body: LIVE_HTML, finalUrl: 'https://www.jobs.example.test/roles/1/' }))
      .toMatchObject({ verdict: 'live', reason: 'heading-match' });
  });

  it('accepts stored titles that carry appended terms', () => {
    const body = page('<h1>Data Intern</h1>');
    expect(judgePage({ ...base, status: 200, body, role: { title: 'Data Intern (Summer 2026)' } })).toMatchObject({ verdict: 'live' });
  });

  it('closes only on an unredirected 404/410; a redirected 404 is not attributable', () => {
    expect(judgePage({ ...base, status: 404, body: '' })).toMatchObject({ verdict: 'closed' });
    expect(judgePage({ ...base, status: 410, body: '' })).toMatchObject({ verdict: 'closed' });
    expect(judgePage({ ...base, status: 404, body: '', finalUrl: 'https://jobs.example.test/careers' }))
      .toMatchObject({ verdict: 'unreadable' });
  });

  it('classifies 403/429/5xx as failed and other statuses as unreadable', () => {
    for (const status of [403, 429, 500, 503]) expect(judgePage({ ...base, status, body: '' }).verdict).toBe('failed');
    expect(judgePage({ ...base, status: 401, body: '' }).verdict).toBe('unreadable');
  });
});

describe('daily cohort under schedule drift', () => {
  it('rechecks a job stamped yesterday evening when today\'s run starts hours earlier', async () => {
    // Observed: runs started 18:19 UTC one day and 10:45 UTC the next was possible.
    const yesterdayLate = '2026-11-12T18:20:00.000Z';
    const todayEarly = new Date('2026-11-13T10:45:00.000Z');
    const roles = [role('drift', { last_verified_at: yesterdayLate })];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, { now: todayEarly, fetchImpl: liveFetch });
    // A fixed 22h or 24h cutoff would have skipped it: it is only 16.4h old.
    expect(result).toMatchObject({ eligible: 1, verified: 1 });
    expect(roles[0].last_verified_at).toBe(todayEarly.toISOString());
  });

  it('does not refetch a job verified a few minutes earlier when two runs straddle midnight UTC', async () => {
    const roles = [role('straddle', { last_verified_at: '2026-11-12T23:50:00.000Z' })];
    const fake = createDb(roles);
    let fetched = 0;
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: new Date('2026-11-13T00:10:00.000Z'),
      fetchImpl: (async () => { fetched += 1; return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch,
    });
    expect(fetched).toBe(0);
    expect(result.eligible).toBe(0);
  });

  it('each job is due exactly once per UTC day across drifting runs', async () => {
    const roles = [role('daily', { last_verified_at: null })];
    const fake = createDb(roles);
    const starts = ['2026-11-10T10:45:00Z', '2026-11-11T20:44:00Z', '2026-11-12T17:50:00Z', '2026-11-13T10:52:00Z'];
    const verifiedDays: string[] = [];
    for (const start of starts) {
      const r = await sweepStaleAggregatorRoles(fake.db, { now: new Date(start), fetchImpl: liveFetch });
      if (r.verified) verifiedDays.push(start.slice(0, 10));
      // A second run the same day finds nothing to do.
      const again = await sweepStaleAggregatorRoles(fake.db, { now: new Date(Date.parse(start) + 30 * 60_000), fetchImpl: liveFetch });
      expect(again.eligible).toBe(0);
    }
    expect(verifiedDays).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });
});

describe('verification follows the pipeline eligibility rules', () => {
  it('never stamps a concluded cohort, a passed deadline, or an expired term, even when the page is live', async () => {
    const roles = [
      role('summer-2026', { seasons: ['Summer'], cohort_year: 2026 }),
      role('deadline', { application_deadline: '2026-11-01' }),
      role('old-term', { title: 'Software Engineering Intern (Summer 2025)' }),
      role('current'),
    ];
    const fake = createDb(roles);
    const fetched: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async (url: string) => { fetched.push(String(url).split('/').pop()!); return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch,
    });
    expect(fetched).toEqual(['current']);
    expect(result).toMatchObject({ ineligible: 3, eligible: 1, verified: 1 });
    for (const id of ['summer-2026', 'deadline', 'old-term']) {
      const row = roles.find((r) => r.id === id)!;
      expect(row.last_verified_at).toBe(OLD);
      expect(row.listing_status).toBe('Active'); // not closed either: same as ingestion
    }
  });

  it('keeps a Fall cohort eligible until its Dec 15 cutoff', async () => {
    const roles = [role('fall', { seasons: ['Fall'], cohort_year: 2026 })];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: liveFetch });
    expect(result).toMatchObject({ ineligible: 0, verified: 1 });
  });
});
// ---------------------------------------------------------------- Access challenges (Muse/Cloudflare regression)

const CHALLENGE_HEADERS = { 'cf-mitigated': 'challenge', server: 'cloudflare' };
const CHALLENGE_PAGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>';
const challenge = () => htmlResponse(403, CHALLENGE_PAGE, '', CHALLENGE_HEADERS);
const museRole = (id: string, overrides: Partial<Row> = {}) =>
  role(id, { external_job_id: `muse-${id}`, apply_url: `https://www.themuse.com/jobs/acme/${id}`, ...overrides });
const amazonRole = (id: string, overrides: Partial<Row> = {}) =>
  role(id, { external_job_id: `amazon-${id}`, apply_url: `https://www.amazon.jobs/en/jobs/${id}/intern`, ...overrides });
const hostFetch = (byHost: Record<string, () => Response>, seen: string[] = []) =>
  (async (url: string) => {
    seen.push(String(url));
    const make = byHost[new URL(String(url)).hostname];
    if (!make) throw new Error(`unexpected host ${url}`);
    return make();
  }) as unknown as typeof fetch;

describe('explicit access challenges', () => {
  it('defers remaining Himalayas checks after an API rate limit without refreshing or closing them', async () => {
    const source = 'https://himalayas.app/companies/acme/jobs/hr-intern';
    const roles = ['1', '2'].map(id => role(id, { external_job_id: `himalayas-${id}`, apply_url: `${source}-${id}`, source_url: `${source}-${id}` }));
    const fake = createDb(roles);
    const seen: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, concurrency: 1, fetchImpl: (async (url: string) => {
      seen.push(String(url));
      return new Response('{}', { status: 429, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch });
    expect(seen).toHaveLength(1);
    expect(result).toMatchObject({ attempted: 1, failed: 1, deferred: 1, verified: 0, closed: 0, cycleComplete: false });
    expect(roles[1]).toMatchObject({ last_verified_at: OLD, last_verification_attempt_at: null });
  });
  it('keeps the cycle incomplete when the feed is blocked and every role is waiting', async () => {
    const fake = createDb([museRole('waiting', {
      next_verification_at: new Date(NOW.getTime() + 86400000).toISOString(),
      last_verification_failure_reason: 'blocked:cloudflare-challenge',
    })]);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, blockedHosts: new Set(['www.themuse.com']), fetchImpl: liveFetch,
    });
    expect(result).toMatchObject({ attempted: 0, recoveryProbes: 0, waitingRetry: 1, cycleComplete: false });
  });
  it('verifies Himalayas jobs through its job API rather than scraping the Apply page', async () => {
    const source = 'https://himalayas.app/companies/acme/jobs/hr-intern';
    const roles = [role('h1', { external_job_id: 'himalayas-stable-id', apply_url: `${source}?utm_source=api`, source_url: source })];
    const fake = createDb(roles);
    const seen: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ job: { guid: source, title: 'HR Operations Lifecycle Intern', expiryDate: NOW.getTime() / 1000 + 86400 } }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch });
    expect(seen).toEqual(['https://himalayas.app/jobs/api/companies/acme/jobs/hr-intern']);
    expect(result).toMatchObject({ verified: 1, closed: 0 });
    expect(roles[0].last_verified_at).toBe(NOW.toISOString());
  });

  it('honours a block from ingestion, skips its probes and still verifies another source', async () => {
    const later = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    const roles = [museRole('ready'), museRole('waiting', {
      next_verification_at: later, last_verification_failure_reason: 'blocked:cloudflare-challenge',
    }), amazonRole('a1')];
    const before = JSON.parse(JSON.stringify(roles.slice(0, 2)));
    const fake = createDb(roles);
    const seen: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, blockedHosts: new Set(['www.themuse.com']),
      fetchImpl: hostFetch({ 'www.amazon.jobs': () => htmlResponse(200, LIVE_HTML) }, seen),
    });
    expect(seen).toEqual(['https://www.amazon.jobs/en/jobs/a1/intern']);
    expect(result).toMatchObject({ attempted: 1, verified: 1, hostBlockedSkipped: 1, recoveryProbes: 0, cycleComplete: false });
    expect(roles.slice(0, 2)).toEqual(before);
  });

  it.each([403, 500])('does not clear blocked-host backoff when a recovery probe returns %i', async status => {
    const later = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    const roles = Array.from({length: 6}, (_, i) => museRole(`m${i}`, {
      next_verification_at: later, last_verification_failure_reason: 'blocked:cloudflare-challenge',
    }));
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, fetchImpl: hostFetch({ 'www.themuse.com': () => htmlResponse(status, 'unavailable') }),
    });
    expect(result).toMatchObject({ recoveryProbes: 3, verified: 0, retryCleared: 0, recoveredHosts: [] });
    expect(roles.every(r => r.next_verification_at !== null && r.last_verified_at === OLD)).toBe(true);
  });

  it('counts a Cloudflare challenge as blocked, not failed, and leaves verification date and status alone', async () => {
    const roles = [museRole('m1')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl: hostFetch({ 'www.themuse.com': challenge }) });
    expect(result).toMatchObject({ attempted: 1, blocked: 1, failed: 0, unreadable: 0, verified: 0, closed: 0 });
    expect(roles[0]).toMatchObject({
      last_verified_at: OLD,
      listing_status: 'Active',
      last_verification_failure_reason: 'blocked:cloudflare-challenge',
      verification_failure_count: 1,
      next_verification_at: new Date(NOW.getTime() + 24 * 3_600_000).toISOString(),
    });
    for (const update of fake.updates) {
      expect(update.patch).not.toHaveProperty('last_verified_at');
      expect(update.patch).not.toHaveProperty('listing_status');
    }
  });

  it('keeps a plain 403 without challenge evidence as an ordinary failure with the short retry', async () => {
    const roles = [museRole('m1')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: hostFetch({ 'www.themuse.com': () => htmlResponse(403, 'Forbidden', '', { server: 'cloudflare' }) }),
    });
    expect(result).toMatchObject({ blocked: 0, failed: 1 });
    expect(roles[0].last_verification_failure_reason).toBe('http-403');
    expect(roles[0].next_verification_at).toBe(new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
  });

  it('stops requesting a host after repeated challenges and still checks other hosts', async () => {
    const roles = [...Array.from({ length: 20 }, (_, i) => museRole(`m${String(i).padStart(2, '0')}`)), amazonRole('a1')];
    const before = JSON.parse(JSON.stringify(roles.slice(0, 20)));
    const fake = createDb(roles);
    const seen: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, concurrency: 1,
      fetchImpl: hostFetch({ 'www.themuse.com': challenge, 'www.amazon.jobs': () => htmlResponse(200, LIVE_HTML) }, seen),
    });
    expect(seen.filter((u) => u.includes('themuse')).length).toBe(3);
    expect(result).toMatchObject({ blocked: 3, hostBlockedSkipped: 17, verified: 1, cycleComplete: false });
    expect(result.blockedHosts).toEqual(['www.themuse.com']);
    // Skipped roles were not attempted, so nothing about them was written.
    const skipped = roles.slice(0, 20).filter((r) => r.last_verification_attempt_at === null);
    expect(skipped).toHaveLength(17);
    for (const r of skipped) expect(r).toEqual(before.find((b: Row) => b.id === r.id));
  });

  it('backs off a role that keeps getting challenged: 24h, then 72h', async () => {
    const roles = [museRole('m1')];
    const fake = createDb(roles);
    const fetchImpl = hostFetch({ 'www.themuse.com': challenge });
    await sweepStaleAggregatorRoles(fake.db, { now: NOW, fetchImpl });
    const second = new Date(NOW.getTime() + 25 * 3_600_000);
    await sweepStaleAggregatorRoles(fake.db, { now: second, fetchImpl });
    expect(roles[0].verification_failure_count).toBe(2);
    expect(roles[0].next_verification_at).toBe(new Date(second.getTime() + 72 * 3_600_000).toISOString());
    expect(roles[0].last_verified_at).toBe(OLD);
  });

  it('sends only a few recovery probes when every role of a blocked host is waiting', async () => {
    const later = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    const roles = Array.from({ length: 10 }, (_, i) => museRole(`m${i}`, {
      last_verification_attempt_at: HOURS(1), last_verification_failure_reason: 'blocked:cloudflare-challenge',
      verification_failure_count: 1, next_verification_at: later,
    }));
    const fake = createDb(roles);
    const seen: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, { now: NOW, concurrency: 1, fetchImpl: hostFetch({ 'www.themuse.com': challenge }, seen) });
    expect(seen).toHaveLength(3);
    expect(result).toMatchObject({
      eligible: 0, recoveryProbes: 3, attempted: 3, blocked: 3, retryCleared: 0,
      retryWaitingAtStart: 10, retryScheduledAtEnd: 10, recoveredHosts: [],
    });
    expect(roles.every((r) => r.last_verified_at === OLD && r.listing_status === 'Active')).toBe(true);
  });

  it('reschedules a recovered host without changing any verification date it did not check', async () => {
    const later = new Date(NOW.getTime() + 48 * 3_600_000).toISOString();
    const roles = Array.from({ length: 6 }, (_, i) => museRole(`m${i}`, {
      last_verification_attempt_at: HOURS(1), last_verification_failure_reason: 'blocked:cloudflare-challenge',
      verification_failure_count: 1, next_verification_at: later,
    }));
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, concurrency: 1, fetchImpl: hostFetch({ 'www.themuse.com': () => htmlResponse(200, LIVE_HTML) }),
    });
    expect(result).toMatchObject({ recoveryProbes: 3, verified: 3, retryCleared: 3, recoveredHosts: ['www.themuse.com'], retryScheduledAtEnd: 0 });
    const unchecked = roles.filter((r) => r.last_verification_attempt_at === HOURS(1));
    expect(unchecked).toHaveLength(3);
    for (const r of unchecked) {
      expect(r.next_verification_at).toBeNull();
      expect(r.last_verified_at).toBe(OLD);
    }
  });
});

describe('retry counts and per-source reporting', () => {
  it('reports waiting-on-retry before and after the run, and a per feed/host breakdown', async () => {
    const later = new Date(NOW.getTime() + 3_600_000).toISOString();
    const roles = [
      amazonRole('w1', { next_verification_at: later, verification_failure_count: 1, last_verification_failure_reason: 'timeout' }),
      amazonRole('w2', { next_verification_at: later, verification_failure_count: 1, last_verification_failure_reason: 'timeout' }),
      museRole('m1'), museRole('m2'),
      amazonRole('ok'),
    ];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW, concurrency: 1,
      fetchImpl: hostFetch({ 'www.themuse.com': () => htmlResponse(503, 'down'), 'www.amazon.jobs': () => htmlResponse(200, LIVE_HTML) }),
    });
    expect(result).toMatchObject({ retryWaitingAtStart: 2, waitingRetry: 2, retryScheduledAtEnd: 4, failed: 2, verified: 1, backlog: 4 });
    const muse = result.bySource.find((b) => b.feed === 'muse');
    const amazon = result.bySource.find((b) => b.feed === 'amazon');
    expect(muse).toMatchObject({ host: 'www.themuse.com', due: 2, attempted: 2, failed: 2, blocked: 0 });
    expect(amazon).toMatchObject({ host: 'www.amazon.jobs', due: 3, waitingAtStart: 2, attempted: 1, verified: 1 });
    expect(fake.runs[0]).toMatchObject({ blocked: 0, retry_waiting_at_start: 2, retry_scheduled_at_end: 4 });
  });

  it('stores feed coverage with the run and falls back to base counts when 0008 is not applied', async () => {
    const feeds = [{ source: 'themuse', coverage: 'blocked' }];
    const applied = createDb([museRole('m1')]);
    await sweepStaleAggregatorRoles(applied.db, { now: NOW, feeds, fetchImpl: hostFetch({ 'www.themuse.com': challenge }) });
    expect(applied.runs[0]).toMatchObject({ feeds, blocked: 1, blocked_hosts: [] });

    const logs: string[] = [];
    const old = createDb([museRole('m1')], { missingRunColumns: true });
    const result = await sweepStaleAggregatorRoles(old.db, { now: NOW, feeds, log: (m) => logs.push(m), fetchImpl: hostFetch({ 'www.themuse.com': challenge }) });
    expect(result.summaryPersisted).toBe(true);
    expect(old.runs[0]).toMatchObject({ attempted: 1, status: 'completed' });
    expect(old.runs[0]).not.toHaveProperty('blocked');
    expect(logs.some((m) => m.includes('0008_verification_blocked_reporting.sql'))).toBe(true);
  });
});

describe('judgePage challenge evidence', () => {
  const base = { contentType: 'text/html', role: { title: 'HR Operations Lifecycle Intern' }, requestedUrl: 'https://www.themuse.com/jobs/acme/1' };
  const headers = (h: Record<string, string>) => new Headers(h);

  it('treats the cf-mitigated header as a challenge at any status, before the 403 rule', () => {
    expect(judgePage({ ...base, status: 403, body: '', headers: headers({ 'cf-mitigated': 'challenge' }) }).verdict).toBe('blocked');
    expect(judgePage({ ...base, status: 503, body: '', headers: headers({ 'cf-mitigated': 'challenge' }) }).verdict).toBe('blocked');
  });

  it('recognises a Cloudflare challenge page on a refusal status', () => {
    expect(judgePage({ ...base, status: 403, body: CHALLENGE_PAGE, headers: headers({ server: 'cloudflare' }) }))
      .toEqual({ verdict: 'blocked', reason: 'blocked:cloudflare-challenge' });
  });

  it('does not call it a challenge without vendor evidence', () => {
    expect(judgePage({ ...base, status: 403, body: CHALLENGE_PAGE, headers: headers({ server: 'nginx' }) }).verdict).toBe('failed');
    expect(judgePage({ ...base, status: 403, body: 'Forbidden', headers: headers({ server: 'cloudflare' }) }).verdict).toBe('failed');
    // Challenge words on an ordinary 200 page are content, not a challenge.
    expect(judgePage({ ...base, status: 200, body: LIVE_HTML + CHALLENGE_PAGE, headers: headers({ server: 'cloudflare' }) }).verdict).toBe('live');
  });
});
// ---------------------------------------------------------------- Seven-day public freshness

describe('public freshness does not affect verification selection', () => {
  const visible = (row: Row) => isFreshlyVerified(row.last_verified_at as string | null, NOW) && row.listing_status === 'Active';

  it('selects jobs hidden from public listings (stale and never verified) and restores them on success', async () => {
    const roles = [
      role('stale', { last_verified_at: HOURS(24 * 10) }),
      role('never', { last_verified_at: null }),
      role('fresh', { last_verified_at: HOURS(2) }),
    ];
    expect(roles.map(visible)).toEqual([false, false, true]);
    const fake = createDb(roles);
    const fetched: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: (async (url: string) => { fetched.push(String(url).split('/').pop()!); return htmlResponse(200, LIVE_HTML); }) as unknown as typeof fetch,
    });
    expect(fetched.sort()).toEqual(['never', 'stale']);
    expect(result.verified).toBe(2);
    expect(roles.map(visible)).toEqual([true, true, true]);
  });

  it('does not extend visibility after blocked or failed attempts', async () => {
    const roles = [
      museRole('blocked', { last_verified_at: HOURS(24 * 10) }),
      role('down', { last_verified_at: HOURS(24 * 10) }),
      role('never', { last_verified_at: null }),
    ];
    const fake = createDb(roles);
    await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: hostFetch({ 'www.themuse.com': challenge, 'jobs.example.test': () => htmlResponse(503, 'down') }),
    });
    // The attempts were recorded, but only last_verified_at decides visibility.
    expect(roles.every((r) => r.last_verification_attempt_at === NOW.toISOString())).toBe(true);
    expect(roles.map(visible)).toEqual([false, false, false]);
    expect(roles.map((r) => r.listing_status)).toEqual(['Active', 'Active', 'Active']);
    expect(roles.map((r) => r.last_verified_at)).toEqual([HOURS(24 * 10), HOURS(24 * 10), null]);
  });
});
