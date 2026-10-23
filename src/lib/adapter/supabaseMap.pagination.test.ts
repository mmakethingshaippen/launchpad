import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from './supabase';
import { DEFAULT_FILTERS } from '../filters';

function client(total: number, oldView = false) {
  const requests: Array<{ select: string; after: string; filters: unknown[] }> = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    id: String(i).padStart(6, '0'), slug: `role-${i}`, title: 'Intern',
    city: 'Seattle', state: 'WA', country: 'USA', seasons: ['Summer'], company_id: 'amazon',
    companies: { name: 'Amazon', slug: 'amazon', company_locations: [] },
  }));
  return { requests, db: { from() {
    const request = { select: '', after: '', filters: [] as unknown[] };
    requests.push(request);
    const q = {
      select(value: string) { request.select = value; return q; },
      order() { return q; }, limit() { return q; },
      gt(_column: string, value: string) { request.after = value; return q; },
      eq(...args: unknown[]) { request.filters.push(['eq', ...args]); return q; },
      overlaps(...args: unknown[]) { request.filters.push(['overlaps', ...args]); return q; },
      in(...args: unknown[]) { request.filters.push(['in', ...args]); return q; },
      ilike(...args: unknown[]) { request.filters.push(['ilike', ...args]); return q; },
      textSearch(...args: unknown[]) { request.filters.push(['textSearch', ...args]); return q; },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(oldView && request.select.includes('latitude, longitude,')
          ? { data: null, error: { code: '42703', message: 'column public_roles.latitude does not exist' } }
          // Deliberately cap pages below 1,000 to test server-configured limits.
          : { data: rows.filter(row => !request.after || row.id > request.after).slice(0, 137), error: null }
        ).then(resolve);
      },
    };
    return q;
  } } as unknown as SupabaseClient };
}

describe('complete map loading', () => {
  it('loads every role beyond the first 1,000 and tolerates smaller server pages', async () => {
    const mock = client(2305);
    const data = await new SupabaseAdapter(mock.db).getMapData(DEFAULT_FILTERS);
    expect(data.markers[0].roleCount).toBe(2305);
    expect(data.unmappedRoles).toHaveLength(0);
    expect(mock.requests.length).toBeGreaterThan(2);
  });

  it('works with the deployed view that has no coordinate columns', async () => {
    const mock = client(8, true);
    const data = await new SupabaseAdapter(mock.db).getMapData(DEFAULT_FILTERS);
    expect(data.markers[0].roleCount).toBe(8);
    expect(mock.requests[1].select).not.toContain('company_id, latitude, longitude,');
  });

  it('uses the same keyword, location, remote and degree filters as Browse', async () => {
    const mock = client(0);
    await new SupabaseAdapter(mock.db).getMapData({ ...DEFAULT_FILTERS, keyword: 'intern',
      city: 'Seattle', remoteOnly: true, degreeLevels: ['Undergraduate'], compensation: ['Paid'] });
    expect(mock.requests[0].filters).toEqual(expect.arrayContaining([
      ['eq', 'work_arrangement', 'Remote'], ['ilike', 'city', '%Seattle%'],
      ['overlaps', 'degree_levels', ['Undergraduate']], ['in', 'compensation_status', ['Paid']],
      ['textSearch', 'search_tsv', 'intern', { type: 'websearch' }],
    ]));
  });
});
