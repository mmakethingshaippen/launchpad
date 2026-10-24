// @vitest-environment node
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SupabaseSink } from './supabaseSink';
import type { UpsertRoleData } from './sync';

function harness(failWrite = false) {
  const writes: Array<Record<string, unknown>[]> = [];
  const reads: string[] = [];
  const existing = [{ id: '001', external_job_id: 'job-1' }, { id: '002', external_job_id: 'job-2' }];
  const closed: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === 'POST') {
      writes.push(JSON.parse(String(init.body)));
      return failWrite ? new Response(JSON.stringify({ message: 'database unavailable' }), { status: 500 })
        : new Response(null, { status: 201 });
    }
    if (init?.method === 'PATCH') {
      closed.push(url.searchParams.get('id') ?? '');
      return new Response(null, { status: 204, headers: { 'content-range': '*/1' } });
    }
    const cursor = url.searchParams.get('id')?.slice(3) ?? '';
    reads.push(cursor);
    return new Response(JSON.stringify(existing.filter(row => row.id > cursor).slice(0, 1)), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const db = createClient('https://test.invalid', 'test-anon', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl },
  });
  return { sink: new SupabaseSink(db), writes, reads, closed };
}
const posting = (externalJobId: string): UpsertRoleData => ({
  companyId: 'example', externalJobId, title: 'Software Engineering Intern',
  descriptionHtml: 'Internship', applyUrl: 'https://example.com/job', city: 'Seattle', state: 'WA', country: 'USA',
  field: 'Technology', seasons: ['Summer'], cohortYear: 2027, opportunityType: 'Internship',
  degreeLevels: ['Undergraduate'],
});

describe('bulk job persistence', () => {
  it('paginates existing ids despite a smaller server cap and writes once per batch', async () => {
    const test = harness();
    expect(await test.sink.upsertRoles([posting('job-1'), posting('job-3')])).toEqual({ imported: 1, updated: 1 });
    expect(test.reads).toEqual(['', '001', '002']);
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]).toHaveLength(2);
    expect(test.writes[0][0]).toMatchObject({ external_job_id: 'job-1', listing_status: 'Active' });
    expect(await test.sink.upsertRoles([posting('job-3')])).toEqual({ imported: 0, updated: 1 });
    expect(test.reads).toHaveLength(3);
  });
  it('surfaces write failures instead of marking them verified', async () => {
    const test = harness(true);
    await expect(test.sink.upsertRoles([posting('job-1')])).rejects.toThrow('database unavailable');
  });
  it('only closes missing job ids after reading every page', async () => {
    const test = harness();
    expect(await test.sink.closeMissing('example', ['job-1'])).toBe(1);
    expect(test.reads).toEqual(['', '001', '002']);
    expect(test.closed).toEqual(['in.(002)']);
  });
});
