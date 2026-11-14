// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jobIdentity, SupabaseSink } from './supabaseSink';
import type { UpsertRoleData } from './sync';

type Row = Record<string, unknown> & { id: string };

/** Minimal PostgREST-shaped fake: keyset reads, upsert, update().in().eq().select(). */
function fakeDb(rows: Row[], opts: { failUpdate?: boolean } = {}) {
  const upserts: Row[][] = [];
  const updates: Array<{ ids: unknown; patch: Row }> = [];
  function from(_table: string) {
    const op = { action: 'select' as 'select' | 'update' | 'upsert', payload: null as unknown, filters: [] as Array<[string, string, unknown]> };
    const b = {
      select() { return b; },
      order() { return b; },
      limit() { return b; },
      eq(c: string, v: unknown) { op.filters.push(['eq', c, v]); return b; },
      gt(c: string, v: unknown) { op.filters.push(['gt', c, v]); return b; },
      in(c: string, v: unknown) { op.filters.push(['in', c, v]); return b; },
      upsert(p: Row[]) { op.action = 'upsert'; op.payload = p; return b; },
      update(p: Row) { op.action = 'update'; op.payload = p; return b; },
      then(resolve: (v: unknown) => unknown) { return Promise.resolve(run()).then(resolve); },
    };
    const match = (r: Row) => op.filters.every(([t, c, v]) =>
      t === 'eq' ? r[c] === v : t === 'gt' ? String(r[c]) > String(v) : (v as unknown[]).includes(r[c]));
    function run() {
      if (op.action === 'upsert') {
        const batch = op.payload as Row[];
        upserts.push(batch);
        for (const r of batch) rows.push({ ...r, id: `new-${rows.length}` });
        return { data: null, error: null };
      }
      const hits = rows.filter(match).sort((a, c) => a.id.localeCompare(c.id));
      if (op.action === 'select') return { data: hits, error: null };
      if (opts.failUpdate) return { data: null, error: { message: 'write rejected' } };
      updates.push({ ids: op.filters.find(([t]) => t === 'in')?.[2], patch: op.payload as Row });
      for (const r of hits) Object.assign(r, op.payload as Row);
      return { data: hits.map((r) => ({ id: r.id })), error: null };
    }
    return b;
  }
  return { db: { from } as unknown as SupabaseClient, upserts, updates, rows };
}

const posting = (externalJobId: string, applyUrl: string): UpsertRoleData => ({
  companyId: 'co-acme', externalJobId, title: 'Data Intern', descriptionHtml: 'Internship', applyUrl,
  city: 'Austin', state: 'TX', country: 'USA', field: 'Technology', seasons: ['Summer'], cohortYear: 2027,
  opportunityType: 'Internship', degreeLevels: ['Undergraduate'],
});
const OLD = '2026-11-01T00:00:00.000Z';

describe('ATS sync does not duplicate jobs an aggregator already imported', () => {
  it('matches Greenhouse job links across board hosts', () => {
    expect(jobIdentity('https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x'))
      .toBe(jobIdentity('https://boards.greenhouse.io/acme/jobs/123'));
    expect(jobIdentity('https://jobs.example.com/a/')).toBe(jobIdentity('https://jobs.example.com/a'));
  });

  it('refreshes the existing aggregator row instead of inserting a second row for the same job', async () => {
    const fake = fakeDb([
      { id: 'agg-1', company_id: 'co-acme', external_job_id: 'simplify-9', apply_url: 'https://job-boards.greenhouse.io/acme/jobs/123',
        source: 'aggregator', listing_status: 'Active', last_verified_at: OLD },
    ]);
    const sink = new SupabaseSink(fake.db);
    const counts = await sink.upsertRoles([
      posting('123', 'https://boards.greenhouse.io/acme/jobs/123'),
      posting('456', 'https://boards.greenhouse.io/acme/jobs/456'),
    ]);
    expect(counts).toEqual({ imported: 1, updated: 1 });
    expect(fake.upserts).toHaveLength(1);
    expect(fake.upserts[0].map((r) => r.external_job_id)).toEqual(['456']);
    expect(fake.rows.find((r) => r.id === 'agg-1')!.last_verified_at).not.toBe(OLD);
  });

  it('still inserts when the matching aggregator row is closed', async () => {
    const fake = fakeDb([
      { id: 'agg-1', company_id: 'co-acme', external_job_id: 'simplify-9', apply_url: 'https://boards.greenhouse.io/acme/jobs/123',
        source: 'aggregator', listing_status: 'Closed', last_verified_at: OLD },
    ]);
    const counts = await new SupabaseSink(fake.db).upsertRoles([posting('123', 'https://boards.greenhouse.io/acme/jobs/123')]);
    expect(counts).toEqual({ imported: 1, updated: 0 });
    expect(fake.rows.find((r) => r.id === 'agg-1')!.last_verified_at).toBe(OLD);
  });

  it('reports a failed refresh as an error instead of counting it', async () => {
    const fake = fakeDb([
      { id: 'agg-1', company_id: 'co-acme', external_job_id: 'simplify-9', apply_url: 'https://boards.greenhouse.io/acme/jobs/123',
        source: 'aggregator', listing_status: 'Active', last_verified_at: OLD },
    ], { failUpdate: true });
    await expect(new SupabaseSink(fake.db).upsertRoles([posting('123', 'https://boards.greenhouse.io/acme/jobs/123')]))
      .rejects.toThrow('write rejected');
    expect(fake.rows.find((r) => r.id === 'agg-1')!.last_verified_at).toBe(OLD);
  });
});