// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from './supabase';
import { DEFAULT_FILTERS } from '../filters';

/**
 * The seven-day freshness rule lives in the public_roles view (migration 0009).
 * Public listings, counts and map markers are only consistent if every one of
 * them reads that view. This records which relation each query targets.
 */
function recordingClient() {
  const reads: string[] = [];
  const builder = (table: string): unknown => {
    let single = false;
    const self: Record<string, unknown> = {};
    const chain = new Proxy(self, {
      get(_target, prop) {
        if (prop === 'then') {
          const result = single
            ? { data: table === 'companies' ? { id: 'c1', slug: 'acme', name: 'Acme', fields: [], degree_levels: [], company_locations: [] } : null, error: null }
            : { data: [], count: 0, error: null };
          return (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
        }
        return (..._args: unknown[]) => {
          if (prop === 'maybeSingle' || prop === 'single') single = true;
          return chain;
        };
      },
    });
    return chain;
  };
  const client = {
    from(table: string) { reads.push(table); return builder(table); },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as unknown as SupabaseClient;
  return { client, reads };
}

describe('SupabaseAdapter public reads go through public_roles', () => {
  it.each([
    ['searchRoles', (a: SupabaseAdapter) => a.searchRoles(DEFAULT_FILTERS)],
    ['searchRoles (other sort)', (a: SupabaseAdapter) => a.searchRoles({ ...DEFAULT_FILTERS, sort: 'recent' })],
    ['searchCompanies', (a: SupabaseAdapter) => a.searchCompanies(DEFAULT_FILTERS)],
    ['getStats', (a: SupabaseAdapter) => a.getStats()],
    ['getFeatured', (a: SupabaseAdapter) => a.getFeatured()],
    ['getMapData', (a: SupabaseAdapter) => a.getMapData(DEFAULT_FILTERS)],
    ['getCompany', (a: SupabaseAdapter) => a.getCompany('acme')],
  ])('%s never reads the roles base table', async (_name, call) => {
    const { client, reads } = recordingClient();
    await call(new SupabaseAdapter(client));
    expect(reads).toContain('public_roles');
    expect(reads).not.toContain('roles');
  });

  it('only the direct-link lookup reads the base table, so it can explain a hidden listing', async () => {
    const { client, reads } = recordingClient();
    await new SupabaseAdapter(client).getRole('acme-data-intern');
    expect(reads).toEqual(['roles']);
  });
});