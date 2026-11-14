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
    expect(result).toMatchObject({ closed: 1, failed: 2, unreadable: 1, verified: 0, writeFailures: 0, clean: true });
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