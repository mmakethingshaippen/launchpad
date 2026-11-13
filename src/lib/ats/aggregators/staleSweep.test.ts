// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { judgePage, sweepStaleAggregatorRoles } from './staleSweep';

type Row = Record<string, unknown> & { id: string };

const NOW = new Date('2026-11-13T12:00:00Z');
const OLD = '2026-10-29T00:00:00Z';
const RECENT = '2026-11-13T01:00:00Z';

function createDb(roles: Row[]) {
  const updates: Array<{ id: string; patch: Row }> = [];
  function from(table: string) {
    const op = {
      action: 'select' as 'select' | 'update',
      payload: {} as Row,
      filters: [] as Array<{ type: 'eq' | 'gt' | 'lt'; col: string; val: unknown }>,
      limit: 1000,
    };
    const builder = {
      select() { return builder; },
      update(payload: Row) { op.action = 'update'; op.payload = payload; return builder; },
      eq(col: string, val: unknown) { op.filters.push({ type: 'eq', col, val }); return builder; },
      gt(col: string, val: unknown) { op.filters.push({ type: 'gt', col, val }); return builder; },
      lt(col: string, val: unknown) { op.filters.push({ type: 'lt', col, val }); return builder; },
      order() { return builder; },
      limit(n: number) { op.limit = n; return builder; },
      then(resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    function matches(row: Row) {
      return op.filters.every((f) => {
        if (f.type === 'eq') return row[f.col] === f.val;
        if (f.type === 'gt') return String(row[f.col]) > String(f.val);
        return String(row[f.col]) < String(f.val);
      });
    }
    function run() {
      if (table !== 'roles') throw new Error(`unexpected table ${table}`);
      const hits = roles.filter(matches);
      if (op.action === 'select') {
        return { data: hits.sort((a, b) => a.id.localeCompare(b.id)).slice(0, op.limit), error: null };
      }
      for (const row of hits) {
        Object.assign(row, op.payload);
        updates.push({ id: row.id, patch: op.payload });
      }
      return { data: null, error: null };
    }
    return builder;
  }
  return { db: { from } as unknown as SupabaseClient, updates };
}

function role(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    title: 'HR Operations Lifecycle Intern',
    apply_url: `https://jobs.example.test/${id}`,
    source: 'aggregator',
    listing_status: 'Active',
    last_verified_at: OLD,
    ...overrides,
  };
}

const LIVE_HTML =
  '<html><body><h1>HR Operations Lifecycle Intern</h1>' + '<p>Apply now.</p>'.repeat(60) + '</body></html>';

function htmlResponse(status: number, body: string) {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

describe('stale aggregator sweep', () => {
  it('closes on 404 and 410', async () => {
    const roles = [role('a'), role('b')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: async (url) => htmlResponse(String(url).endsWith('/a') ? 404 : 410, 'gone'),
    });
    expect(result).toMatchObject({ closed: 2, refreshed: 0, unread: 0 });
    expect(roles.map((r) => r.listing_status)).toEqual(['Closed', 'Closed']);
    expect(roles.every((r) => r.last_verified_at === OLD)).toBe(true);
  });

  it('re-stamps last_verified_at when the page shows live job content', async () => {
    const roles = [role('a')];
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: async () => htmlResponse(200, LIVE_HTML),
    });
    expect(result).toMatchObject({ refreshed: 1, closed: 0, unread: 0 });
    expect(roles[0].listing_status).toBe('Active');
    expect(String(roles[0].last_verified_at) > OLD).toBe(true);
  });

  it('leaves the row unchanged when the fetch fails or the page is unreadable', async () => {
    const roles = [role('net'), role('500'), role('soft'), role('empty'), role('badurl', { apply_url: 'ftp://x' })];
    const before = JSON.parse(JSON.stringify(roles));
    const fake = createDb(roles);
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.endsWith('/net')) throw new TypeError('network down');
        if (u.endsWith('/500')) return htmlResponse(500, 'oops');
        if (u.endsWith('/soft')) return htmlResponse(200, `<html>${'x '.repeat(400)}This job is no longer available.</html>`);
        return htmlResponse(200, '<html></html>');
      },
    });
    expect(result).toMatchObject({ refreshed: 0, closed: 0, unread: 5 });
    expect(fake.updates).toHaveLength(0);
    expect(roles).toEqual(before);
  });

  it('skips rows verified within 24 hours, closed rows, and non-aggregator rows', async () => {
    const roles = [
      role('fresh', { last_verified_at: RECENT }),
      role('closed', { listing_status: 'Closed' }),
      role('ats', { source: 'ats' }),
    ];
    const fake = createDb(roles);
    let fetched = 0;
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: async () => { fetched += 1; return htmlResponse(404, ''); },
    });
    expect(fetched).toBe(0);
    expect(result.checked).toBe(0);
  });

  it('checks a job after 25 hours while leaving a job verified 23 hours ago alone', async () => {
    const roles = [
      role('due', { last_verified_at: '2026-11-12T11:00:00Z' }),
      role('recent', { last_verified_at: '2026-11-12T13:00:00Z' }),
    ];
    const fake = createDb(roles);
    const fetched: string[] = [];
    const result = await sweepStaleAggregatorRoles(fake.db, {
      now: NOW,
      fetchImpl: async url => { fetched.push(String(url)); return htmlResponse(200, LIVE_HTML); },
    });
    expect(result).toMatchObject({ checked: 1, refreshed: 1 });
    expect(fetched).toEqual(['https://jobs.example.test/due']);
    expect(roles[1].last_verified_at).toBe('2026-11-12T13:00:00Z');
  });

  it('does not close a 200 page with no job content, and judgePage requires an explicit 404 or 410', () => {
    expect(judgePage(200, 'text/html', LIVE_HTML, 'Other Title')).toBe('unread');
    expect(judgePage(403, 'text/html', 'x', 'T')).toBe('unread');
    expect(judgePage(404, '', '', 'T')).toBe('closed');
    expect(judgePage(410, '', '', 'T')).toBe('closed');
  });
});
