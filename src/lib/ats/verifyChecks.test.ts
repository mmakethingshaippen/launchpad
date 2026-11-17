// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FetchLike } from './types';
import { loadAllPages } from './dbPaging';
import { confirmEmployerRoles, recheckWorkdayRoles } from './verifyChecks';

type Row = Record<string, unknown> & { id: string };

const NOW = new Date('2026-11-13T18:00:00Z');
const RUN_START = new Date('2026-11-13T17:46:00Z');
const OLD = '2026-11-08T10:00:00.000Z';

/** PostgREST-shaped fake: keyset paging, a server row cap, `.or()` NULL clauses, `.select()` after update. */
function createDb(tables: { companies?: Row[]; roles?: Row[] }, options: { maxRows?: number; zeroRowIds?: string[]; failUpdateIds?: string[] } = {}) {
  const data: Record<string, Row[]> = { companies: tables.companies ?? [], roles: tables.roles ?? [] };
  const updates: Array<{ id: string; patch: Row }> = [];
  const selects: Array<{ table: string; limit: number }> = [];
  function from(table: string) {
    const op = {
      action: 'select' as 'select' | 'update',
      payload: {} as Row,
      filters: [] as Array<{ type: string; col: string; val: unknown }>,
      limit: 1000,
    };
    const builder = {
      select() { return builder; },
      update(payload: Row) { op.action = 'update'; op.payload = payload; return builder; },
      eq(col: string, val: unknown) { op.filters.push({ type: 'eq', col, val }); return builder; },
      gt(col: string, val: unknown) { op.filters.push({ type: 'gt', col, val }); return builder; },
      in(col: string, val: unknown) { op.filters.push({ type: 'in', col, val }); return builder; },
      not(col: string, _op: string, _val: unknown) { op.filters.push({ type: 'notnull', col, val: null }); return builder; },
      or(expr: string) { op.filters.push({ type: 'or', col: '', val: expr }); return builder; },
      order() { return builder; },
      limit(n: number) { op.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    function orMatch(row: Row, expr: string) {
      return expr.split(/,(?=[a-z_]+\.)/).some((clause) => {
        const [col, operator, ...rest] = clause.split('.');
        const value = rest.join('.');
        if (operator === 'is' && value === 'null') return row[col] == null;
        if (operator === 'lt') return row[col] != null && String(row[col]) < value;
        throw new Error(`unsupported clause ${clause}`);
      });
    }
    function matches(row: Row) {
      return op.filters.every((f) => {
        if (f.type === 'eq') return row[f.col] === f.val;
        if (f.type === 'gt') return String(row[f.col]) > String(f.val);
        if (f.type === 'in') return (f.val as unknown[]).includes(row[f.col]);
        if (f.type === 'notnull') return row[f.col] != null;
        return orMatch(row, String(f.val));
      });
    }
    function run() {
      const rows = data[table].filter(matches);
      if (op.action === 'select') {
        selects.push({ table, limit: op.limit });
        const cap = Math.min(op.limit, options.maxRows ?? Infinity);
        const page = rows.sort((a, b) => a.id.localeCompare(b.id)).slice(0, cap).map((r) => {
          if (table !== 'roles') return r;
          const company = data.companies.find((c) => c.id === r.company_id);
          return { ...r, companies: company ?? null };
        });
        return { data: page, error: null };
      }
      const changed: Array<{ id: string }> = [];
      for (const row of rows) {
        if (options.failUpdateIds?.includes(row.id)) return { data: null, error: { message: 'write rejected' } };
        if (options.zeroRowIds?.includes(row.id)) continue;
        Object.assign(row, op.payload);
        updates.push({ id: row.id, patch: op.payload });
        changed.push({ id: row.id });
      }
      return { data: changed, error: null };
    }
    return builder;
  }
  return { db: { from } as unknown as SupabaseClient, data, updates, selects };
}

const TOKEN = 'cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers';
const wdUrl = (id: string) => `https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS_Health_Careers/job/Remote/Analyst-Intern_${id}`;
const wdRole = (id: string, overrides: Partial<Row> = {}): Row => ({
  id, company_id: 'co-cvs', apply_url: wdUrl(id), title: 'Analyst Intern', listing_status: 'Active',
  source: 'ats', last_verified_at: OLD, verification_failure_count: 0, ...overrides,
});

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const respond = (status: number, body: unknown = {}): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function workdayFetch(byId: Record<string, FakeResponse | Error>, seen: string[] = []): FetchLike {
  return (async (url: string) => {
    const id = String(url).split('_').pop()!;
    seen.push(id);
    const r = byId[id] ?? respond(200, { jobPostingInfo: { title: 'Analyst Intern' } });
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as FetchLike;
}

describe('loadAllPages', () => {
  it('reads past short pages until an empty page', async () => {
    const all = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
    const load = await loadAllPages<{ id: string }>(async (after) => ({
      data: all.filter((r) => r.id > after).slice(0, 2), error: null,
    }));
    expect(load).toMatchObject({ complete: true, pages: 4, stopReason: 'empty page reached' });
    expect(load.rows).toHaveLength(7);
  });

  it('stops with a reason when the cursor does not advance', async () => {
    const load = await loadAllPages<{ id: string }>(async () => ({ data: [{ id: 'same' }], error: null }));
    expect(load.complete).toBe(false);
    expect(load.stopReason).toMatch(/no cursor progress/);
    expect(load.rows).toHaveLength(1);
  });

  it('reports a database error as incomplete', async () => {
    let calls = 0;
    const load = await loadAllPages<{ id: string }>(async () => (++calls === 1
      ? { data: [{ id: 'a' }], error: null }
      : { data: null, error: { message: 'boom' } }));
    expect(load).toMatchObject({ complete: false, pages: 1 });
    expect(load.stopReason).toMatch(/boom/);
  });
});

describe('Workday page recheck', () => {
  const company = { id: 'co-cvs', ats_provider: 'workday', ats_board_token: TOKEN };

  it('does not re-request a host blocked by the board stage and still checks other employers', async () => {
    const otherToken = 'other.wd1.myworkdayjobs.com|other|External';
    const fake = createDb({
      companies: [company, { id: 'co-other', ats_provider: 'workday', ats_board_token: otherToken }],
      roles: [wdRole('R1'), wdRole('R2'), wdRole('R3', {
        company_id: 'co-other', apply_url: 'https://other.wd1.myworkdayjobs.com/en-US/External/job/Remote/Intern_R3',
      })],
    });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}, seen),
      blockedHosts: new Set(['cvshealth.wd1.myworkdayjobs.com']),
    });
    expect(seen).toEqual(['R3']);
    expect(result).toMatchObject({ candidates: 3, attempted: 1, verified: 1, hostBlockedSkipped: 2, clean: false });
    expect(fake.updates.map(u => u.id)).toEqual(['R3']);
    expect(fake.data.roles[0].last_verified_at).toBe(OLD);
  });

  it('includes NULL last_verified_at and skips roles the list download already refreshed', async () => {
    const fake = createDb({
      companies: [company],
      roles: [
        wdRole('R1', { last_verified_at: null }),
        wdRole('R2'),
        wdRole('R3', { last_verified_at: '2026-11-13T17:50:00.000Z' }),
      ],
    });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}, seen) });
    expect(seen.sort()).toEqual(['R1', 'R2']);
    expect(result).toMatchObject({ candidates: 2, verified: 2, clean: true });
    expect(fake.data.roles[0].last_verified_at).toBe(NOW.toISOString());
  });

  it('reads every role when the server caps pages below the requested size', async () => {
    const roles = Array.from({ length: 7 }, (_, i) => wdRole(`R${i}`));
    const fake = createDb({ companies: [company], roles }, { maxRows: 2 });
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}) });
    expect(result).toMatchObject({ candidates: 7, verified: 7 });
    expect(result.coverage.complete).toBe(true);
  });

  it('does not count a stamp that matched no row, and reports the stage unclean', async () => {
    const fake = createDb({ companies: [company], roles: [wdRole('R1'), wdRole('R2')] }, { zeroRowIds: ['R1'] });
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}) });
    expect(result).toMatchObject({ verified: 1, failed: 1, writeFailures: 1, clean: false });
  });

  it('counts a database error on a close as a failure, not a close', async () => {
    const fake = createDb({ companies: [company], roles: [wdRole('R1')] }, { failUpdateIds: ['R1'] });
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({ R1: respond(404) }) });
    expect(result).toMatchObject({ closed: 0, failed: 1, writeFailures: 1, clean: false });
    expect(fake.data.roles[0].listing_status).toBe('Active');
  });

  it('closes on 404, records failed and unreadable attempts without touching last_verified_at', async () => {
    const fake = createDb({ companies: [company], roles: [wdRole('GONE'), wdRole('DOWN'), wdRole('EMPTY'), wdRole('NET')] });
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW,
      fetchImpl: workdayFetch({ GONE: respond(404), DOWN: respond(503), EMPTY: respond(200, {}), NET: new TypeError('socket hang up') }),
    });
    expect(result).toMatchObject({ closed: 1, failed: 2, unreadable: 1, verified: 0, writeFailures: 0, clean: false });
    const byId = Object.fromEntries(fake.data.roles.map((r) => [r.id, r]));
    expect(byId.GONE.listing_status).toBe('Closed');
    for (const id of ['DOWN', 'EMPTY', 'NET']) {
      expect(byId[id].last_verified_at).toBe(OLD);
      expect(byId[id].last_verification_attempt_at).toBe(NOW.toISOString());
      expect(byId[id].verification_failure_count).toBe(1);
    }
    expect(byId.DOWN.last_verification_failure_reason).toBe('http-503');
  });

  it('never fetches or stamps a concluded or expired role', async () => {
    const fake = createDb({
      companies: [company],
      roles: [
        wdRole('SUMMER', { seasons: ['Summer'], cohort_year: 2026 }),
        wdRole('DEADLINE', { application_deadline: '2026-10-01' }),
        wdRole('LIVE'),
      ],
    });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}, seen) });
    expect(seen).toEqual(['LIVE']);
    expect(result).toMatchObject({ ineligible: 2, verified: 1 });
    expect(fake.data.roles.find((r) => r.id === 'SUMMER')!.last_verified_at).toBe(OLD);
  });
});

describe('Employer board confirmation', () => {
  const gh = { id: 'co-gh', ats_provider: 'greenhouse', ats_board_token: 'acme' };
  const ghRole = (id: string, jobId: string, overrides: Partial<Row> = {}): Row => ({
    id, company_id: 'co-gh', apply_url: `https://boards.greenhouse.io/acme/jobs/${jobId}`,
    title: 'Data Intern', listing_status: 'Active', last_verified_at: OLD, ...overrides,
  });
  const board = (open: number[] | null, fetched: string[] = []): FetchLike => (async (url: string) => {
    fetched.push(String(url));
    if (!open) return respond(503);
    return respond(200, { jobs: open.map((id) => ({ id })) });
  }) as unknown as FetchLike;

  it('confirms open roles, closes absent ones, and never stamps a concluded role', async () => {
    const fake = createDb({
      companies: [gh],
      roles: [ghRole('open', '1'), ghRole('gone', '2'), ghRole('concluded', '3', { seasons: ['Summer'], cohort_year: 2026 })],
    });
    const result = await confirmEmployerRoles(fake.db, { now: NOW, fetchImpl: board([1, 3]) });
    expect(result).toMatchObject({ confirmed: 1, closed: 1, ineligible: 1, writeFailures: 0, clean: true });
    const byId = Object.fromEntries(fake.data.roles.map((r) => [r.id, r]));
    expect(byId.open.last_verified_at).toBe(NOW.toISOString());
    expect(byId.gone.listing_status).toBe('Closed');
    expect(byId.concluded.last_verified_at).toBe(OLD);
  });

  it('reports a failed board as unclean and leaves its roles unchanged', async () => {
    const fake = createDb({ companies: [gh], roles: [ghRole('a', '1')] });
    const result = await confirmEmployerRoles(fake.db, { now: NOW, fetchImpl: board(null) });
    expect(result).toMatchObject({ boardsFailed: 1, confirmed: 0, closed: 0, clean: false });
    expect(fake.data.roles[0]).toMatchObject({ listing_status: 'Active', last_verified_at: OLD });
  });

  it('counts only rows the database changed', async () => {
    const fake = createDb({ companies: [gh], roles: [ghRole('a', '1'), ghRole('b', '2')] }, { zeroRowIds: ['b'] });
    const result = await confirmEmployerRoles(fake.db, { now: NOW, fetchImpl: board([1, 2]) });
    expect(result).toMatchObject({ confirmed: 1, writeFailures: 1, clean: false });
  });

  it('reads every active role under a small server page cap', async () => {
    const roles = Array.from({ length: 9 }, (_, i) => ghRole(`r${i}`, String(i + 1)));
    const fake = createDb({ companies: [gh], roles }, { maxRows: 4 });
    const result = await confirmEmployerRoles(fake.db, { now: NOW, fetchImpl: board(roles.map((_, i) => i + 1)) });
    expect(result).toMatchObject({ rolesScanned: 9, confirmed: 9, clean: true });
    expect(result.coverage).toMatchObject({ complete: true, pages: 3 });
  });
});
describe('Workday recheck access challenges', () => {
  const company = { id: 'co-cvs', ats_provider: 'workday', ats_board_token: TOKEN };
  it('counts an explicit challenge as blocked and a plain 403 as failed; neither changes the verification date', async () => {
    const roles = [wdRole('R1'), wdRole('R2')];
    const fake = createDb({ companies: [company], roles });
    const challenged = { ...respond(403), headers: new Headers({ 'cf-mitigated': 'challenge' }) };
    const plain = { ...respond(403), headers: new Headers({ server: 'nginx' }) };
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({ R1: challenged, R2: plain }),
    });
    expect(result).toMatchObject({ attempted: 2, blocked: 1, failed: 1, verified: 0, closed: 0 });
    expect(roles[0]).toMatchObject({ last_verified_at: OLD, listing_status: 'Active', last_verification_failure_reason: 'blocked:cloudflare-challenge' });
    expect(roles[1]).toMatchObject({ last_verified_at: OLD, listing_status: 'Active', last_verification_failure_reason: 'http-403' });
  });
});
describe('Workday recheck: retries, evidence, backoff and fair progress', () => {
  const company = { id: 'co-cvs', ats_provider: 'workday', ats_board_token: TOKEN };
  const sequenceFetch = (byId: Record<string, FakeResponse[]>, seen: string[] = []): FetchLike =>
    (async (url: string) => {
      const id = String(url).split('_').pop()!;
      seen.push(id);
      const queue = byId[id];
      return queue && queue.length ? queue.shift()! : respond(200, { jobPostingInfo: { title: 'Analyst Intern', canApply: true } });
    }) as unknown as FetchLike;

  it('retries a transient 521 and verifies the job when the tenant answers', async () => {
    const roles = [wdRole('R1')];
    const fake = createDb({ companies: [company], roles });
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: sequenceFetch({ R1: [respond(521)] }),
    });
    expect(result).toMatchObject({ attempted: 1, verified: 1, failed: 0 });
    expect(roles[0].last_verified_at).toBe(NOW.toISOString());
  });

  it('records a reason and a retry time when the tenant keeps failing, and never changes the date', async () => {
    const roles = [wdRole('R1')];
    const fake = createDb({ companies: [company], roles });
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: sequenceFetch({ R1: [respond(521), respond(521), respond(521), respond(521)] }),
    });
    expect(result).toMatchObject({ failed: 1, verified: 0, closed: 0, failureReasons: { 'http-521': 1 } });
    expect(roles[0]).toMatchObject({ last_verified_at: OLD, listing_status: 'Active', last_verification_failure_reason: 'http-521' });
    expect(Date.parse(String(roles[0].next_verification_at))).toBeGreaterThan(NOW.getTime());
  });

  it('does not verify a posting that is not accepting applications, or one whose title does not match', async () => {
    const roles = [wdRole('R1'), wdRole('R2')];
    const fake = createDb({ companies: [company], roles });
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW,
      fetchImpl: sequenceFetch({
        R1: [respond(200, { jobPostingInfo: { title: 'Analyst Intern', canApply: false } })],
        R2: [respond(200, { jobPostingInfo: { title: 'Senior Director of Finance', canApply: true } })],
      }),
    });
    expect(result).toMatchObject({ verified: 0, closed: 0, unreadable: 2 });
    expect(result.failureReasons).toEqual({ 'not-accepting-applications': 1, 'title-mismatch': 1 });
    expect(roles.every((r) => r.last_verified_at === OLD && r.listing_status === 'Active')).toBe(true);
  });

  it('does not map a link on a different Workday tenant, so its 404 cannot close this company\'s job', async () => {
    const roles = [wdRole('R1', { apply_url: 'https://othertenant.wd1.myworkdayjobs.com/en-US/External/job/X/Analyst-Intern_R1' })];
    const fake = createDb({ companies: [company], roles });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: sequenceFetch({ R1: [respond(404)] }, seen),
    });
    expect(seen).toEqual([]);
    expect(result).toMatchObject({ unmapped: 1, closed: 0 });
    expect(roles[0].listing_status).toBe('Active');
  });

  it('waits for a scheduled retry time instead of requesting the job again', async () => {
    const roles = [wdRole('R1', { next_verification_at: new Date(NOW.getTime() + 3_600_000).toISOString() })];
    const fake = createDb({ companies: [company], roles });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: sequenceFetch({}, seen) });
    expect(seen).toEqual([]);
    expect(result).toMatchObject({ waitingRetry: 1, attempted: 0 });
  });

  it('checks the least recently attempted jobs first and defers the rest when the budget ends', async () => {
    const roles = [
      wdRole('R1', { last_verification_attempt_at: '2026-11-13T10:00:00.000Z' }),
      wdRole('R2', { last_verification_attempt_at: null }),
      wdRole('R3', { last_verification_attempt_at: '2026-11-12T10:00:00.000Z' }),
    ];
    const fake = createDb({ companies: [company], roles });
    const seen: string[] = [];
    let ticks = 0;
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, concurrency: 1, budgetMs: 15, clock: () => (ticks += 10),
      fetchImpl: sequenceFetch({}, seen),
    });
    expect(seen).toEqual(['R2']);
    expect(result).toMatchObject({ attempted: 1, deferred: 2, clean: false });
    // Deferred jobs were not written: their attempt time is unchanged, so they lead the next run.
    expect(roles.find((r) => r.id === 'R3')!.last_verification_attempt_at).toBe('2026-11-12T10:00:00.000Z');
  });

  it('stops requesting a host after repeated access challenges', async () => {
    const roles = Array.from({ length: 6 }, (_, i) => wdRole(`R${i}`));
    const fake = createDb({ companies: [company], roles });
    const challenged = () => ({ ...respond(403), headers: new Headers({ 'cf-mitigated': 'challenge' }) });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, concurrency: 1,
      fetchImpl: (async (url: string) => { seen.push(String(url)); return challenged(); }) as unknown as FetchLike,
    });
    expect(seen).toHaveLength(3);
    expect(result).toMatchObject({ blocked: 3, hostBlockedSkipped: 3, verified: 0, closed: 0, clean: false });
    expect(roles.every((r) => r.last_verified_at === OLD && r.listing_status === 'Active')).toBe(true);
  });
});

describe('employer confirmation clears earlier failure state', () => {
  it('resets failure columns when the job is on the employer board', async () => {
    const roles = [{
      id: 'gh1', company_id: 'co-gh', apply_url: 'https://boards.greenhouse.io/acme/jobs/100', title: 'Data Intern',
      listing_status: 'Active', source: 'aggregator', last_verified_at: OLD,
      last_verification_failure_reason: 'timeout', verification_failure_count: 2, next_verification_at: '2026-11-20T00:00:00.000Z',
    }];
    const fake = createDb({ companies: [{ id: 'co-gh', ats_provider: 'greenhouse', ats_board_token: 'acme' }], roles });
    const result = await confirmEmployerRoles(fake.db, {
      now: NOW,
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ jobs: [{ id: 100 }] }) })) as unknown as FetchLike,
    });
    expect(result.confirmed).toBe(1);
    expect(roles[0]).toMatchObject({
      last_verified_at: NOW.toISOString(), last_verification_failure_reason: null, verification_failure_count: 0, next_verification_at: null,
    });
  });
});
describe('maintenance pages are failures, never evidence', () => {
  const maintenance = () => {
    const res = new Response('<!DOCTYPE html><html><head><title>Workday is currently unavailable.</title></head></html>', {
      status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' },
    });
    Object.defineProperty(res, 'url', { value: 'https://community.workday.com/maintenance-page' });
    return res;
  };

  it('records a Workday detail maintenance redirect as a failure and keeps the date and status', async () => {
    const company = { id: 'co-cvs', ats_provider: 'workday', ats_board_token: TOKEN };
    const roles = [wdRole('R1')];
    const fake = createDb({ companies: [company], roles });
    const result = await recheckWorkdayRoles(fake.db, {
      refreshedSince: RUN_START, now: NOW, fetchImpl: (async () => maintenance()) as unknown as FetchLike,
    });
    expect(result).toMatchObject({ failed: 1, verified: 0, closed: 0, unreadable: 0 });
    expect(Object.keys(result.failureReasons)).toEqual(['maintenance: maintenance (redirected to community.workday.com/maintenance-page)']);
    expect(roles[0]).toMatchObject({ last_verified_at: OLD, listing_status: 'Active' });
  });

  it('names failed employer boards with reasons and logs the skipped breakdown', async () => {
    const roles = [
      { id: 'gh1', company_id: 'co-gh', apply_url: 'https://boards.greenhouse.io/acme/jobs/100', title: 'Data Intern', listing_status: 'Active', source: 'ats', last_verified_at: OLD },
      { id: 'wd1', company_id: 'co-gh', apply_url: 'https://target.wd5.myworkdayjobs.com/en-US/targetcareers/job/X_R1', title: 'Intern', listing_status: 'Active', source: 'ats', last_verified_at: OLD },
    ];
    const fake = createDb({ companies: [{ id: 'co-gh', ats_provider: 'greenhouse', ats_board_token: 'acme' }], roles });
    const logs: string[] = [];
    const result = await confirmEmployerRoles(fake.db, {
      now: NOW, log: (m) => logs.push(m),
      fetchImpl: (async () => {
        const res = new Response('<html><head><title>Scheduled maintenance</title></head></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        return res;
      }) as unknown as FetchLike,
    });
    expect(result).toMatchObject({ boardsFailed: 1, skippedBoardFailed: 1, skippedUnsupported: 1, confirmed: 0, closed: 0 });
    expect(result.failedBoards).toEqual([{ provider: 'greenhouse', token: 'acme', reason: 'maintenance: maintenance', roles: 1 }]);
    expect(logs.some((m) => m.includes('skipped 2 (unsupported URL 1, on unreadable boards 1)'))).toBe(true);
    expect(logs.some((m) => m.includes('failed board greenhouse acme: maintenance: maintenance; 1 job(s) not checked'))).toBe(true);
    expect(logs.some((m) => m.includes('target.wd5.myworkdayjobs.com 1'))).toBe(true);
    expect(roles.map((r) => r.listing_status)).toEqual(['Active', 'Active']);
    expect(roles.map((r) => r.last_verified_at)).toEqual([OLD, OLD]);
  });
});
describe('unmapped Workday candidates are grouped by employer and reason', () => {
  it('explains each unsupported link and leaves it unverified', async () => {
    const company = { id: 'co-cvs', slug: 'cvs-health', ats_provider: 'workday', ats_board_token: TOKEN };
    const roles = [
      wdRole('R1', { apply_url: 'https://www.themuse.com/jobs/cvshealth/analyst-intern' }),
      wdRole('R2', { apply_url: 'https://othertenant.wd1.myworkdayjobs.com/en-US/External/job/X/Analyst-Intern_R2' }),
      wdRole('R3', { apply_url: 'https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS_Health_Careers' }),
      wdRole('R4', { apply_url: null }),
      wdRole('R5'),
    ];
    const fake = createDb({ companies: [company], roles });
    const seen: string[] = [];
    const result = await recheckWorkdayRoles(fake.db, { refreshedSince: RUN_START, now: NOW, fetchImpl: workdayFetch({}, seen) });
    expect(result.unmapped).toBe(4);
    expect(result.unmappedReasons).toEqual({
      'cvs-health: non-workday host themuse.com': 1,
      'cvs-health: other workday tenant othertenant': 1,
      'cvs-health: workday url without /job/ path': 1,
      'cvs-health: no apply url': 1,
    });
    expect(seen).toEqual(['R5']);
    expect(roles.slice(0, 4).every((r) => r.last_verified_at === OLD && r.listing_status === 'Active')).toBe(true);
  });
});
