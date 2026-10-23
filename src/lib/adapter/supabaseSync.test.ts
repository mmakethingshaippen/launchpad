import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from './supabase';

/** Minimal fake Supabase client exposing only what sync() touches. */
function fakeClient(accessToken: string | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

const realFetch = globalThis.fetch;

describe('SupabaseAdapter.sync() authorization', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('attaches the session access token as a Bearer header', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ company: 'Acme', companyId: '1', imported: 2, updated: 0, closed: 0, errors: [] }],
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const adapter = new SupabaseAdapter(fakeClient('token-abc'));
    const results = await adapter.sync();

    expect(results).toHaveLength(1);
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/sync');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
  });

  it('passes a single company id in the query string', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const adapter = new SupabaseAdapter(fakeClient('token-xyz'));
    await adapter.sync('company-7');

    const [url] = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(url).toBe('/api/sync?id=company-7');
  });


  it('requests a paginated sync batch and parses the progress envelope', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ company: 'Acme', companyId: '1', imported: 2, updated: 0, closed: 0, errors: [] }],
        syncedCount: 1,
        nextOffset: 40,
        totalCompanies: 81,
        done: false,
      }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const adapter = new SupabaseAdapter(fakeClient('token-batch'));
    const batch = await adapter.syncBatch({ offset: 0, limit: 40, timeBudgetMs: 45000 });

    expect(batch.syncedCount).toBe(1);
    expect(batch.nextOffset).toBe(40);
    expect(batch.totalCompanies).toBe(81);
    expect(batch.done).toBe(false);
    const [url] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toBe('/api/sync?offset=0&limit=40&timeBudgetMs=45000');
  });

  it('throws a clear error when there is no session', async () => {
    const adapter = new SupabaseAdapter(fakeClient(null));
    await expect(adapter.sync()).rejects.toThrow(/signed in as an admin/i);
  });

  it('maps a 403 to an admin-permission message', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })) as unknown as typeof fetch;
    const adapter = new SupabaseAdapter(fakeClient('token-abc'));
    await expect(adapter.sync()).rejects.toThrow(/not an admin/i);
  });

  it('maps a 401 to a re-authenticate message', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) })) as unknown as typeof fetch;
    const adapter = new SupabaseAdapter(fakeClient('token-abc'));
    await expect(adapter.sync()).rejects.toThrow(/sign in again/i);
  });
});
