import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { SupabaseAdapter } from './supabase';
import type { ApplicationInput } from './types';
import * as localStore from '../localStore';

const input: ApplicationInput = {
  roleId: 'role-1', companyName: 'Example', roleTitle: 'Engineering Intern', status: 'Applied',
};
const databaseRow = {
  id: 'application-1', user_id: 'user-1', role_id: 'role-1',
  company_name: 'Example', role_title: 'Engineering Intern', status: 'Applied',
  notes: 'Keep this note', application_url: 'https://example.com/apply',
  applied_at: '2026-10-01', follow_up_date: '2026-10-30',
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-23T00:00:00.000Z',
};

interface RequestRecord { url: URL; method: string; body: Record<string, unknown> | null }
let fixtureId = 0;

function fixture(options: { userId?: string | null; authError?: boolean; status?: number; rows?: unknown[] } = {}) {
  const requests: RequestRecord[] = [];
  const fetchMock: typeof fetch = async (resource, init) => {
    const url = new URL(typeof resource === 'string' ? resource : resource instanceof URL ? resource.href : resource.url);
    const method = init?.method ?? 'GET';
    requests.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const failed = (options.status ?? 200) >= 400;
    const rows = options.rows ?? [databaseRow];
    const single = new Headers(init?.headers).get('Accept')?.includes('vnd.pgrst.object+json');
    const body = failed
      ? { code: '42501', message: 'permission denied by row-level security policy', details: null, hint: null }
      : single ? rows[0] ?? null : rows;
    return new Response(JSON.stringify(body), {
      status: options.status ?? 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  const db = createClient('https://tracking-test.supabase.co', 'public-test-key', {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false, storageKey: `tracking-test-${++fixtureId}` },
    global: { fetch: fetchMock },
  });
  const userId = options.userId === undefined ? 'user-1' : options.userId;
  const getUser = vi.spyOn(db.auth, 'getUser').mockResolvedValue({
    data: { user: userId ? { id: userId } : null },
    error: options.authError ? new Error('Session expired') : null,
  } as Awaited<ReturnType<typeof db.auth.getUser>>);
  return { adapter: new SupabaseAdapter(db), requests, getUser };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('tracking persistence and account boundaries', () => {
  it('keeps explicit guest writes, reads, and removals local even if a session exists', async () => {
    const { adapter, getUser, requests } = fixture();
    const saved = await adapter.upsertApplication(input, null);
    expect(saved).toMatchObject({ roleId: 'role-1', status: 'Applied' });
    const applications = await adapter.listApplications(null);
    expect(applications).toHaveLength(1);
    await adapter.deleteApplication(applications[0].id, null);
    expect(await adapter.listApplications(null)).toEqual([]);
    expect(getUser).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('resolves the session for callers that omit account scope', async () => {
    const guest = fixture({ userId: null });
    await guest.adapter.upsertApplication(input);
    expect(await guest.adapter.listApplications()).toHaveLength(1);
    expect(guest.requests).toEqual([]);
    const authenticated = fixture();
    await authenticated.adapter.listApplications();
    expect(authenticated.requests[0].url.pathname).toBe('/rest/v1/tracked_applications');
    expect(authenticated.requests[0].url.searchParams.get('user_id')).toBe('eq.user-1');
  });

  it.each(['list', 'save', 'delete'] as const)('refuses %s when the account changed before persistence', async (operation) => {
    const { adapter, requests } = fixture({ userId: 'different-user' });
    const promise = operation === 'list' ? adapter.listApplications('user-1')
      : operation === 'save' ? adapter.upsertApplication(input, 'user-1')
        : adapter.deleteApplication('application-1', 'user-1');
    await expect(promise).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(localStore.getApplications()).toEqual([]);
  });

  it('does not silently save account data locally when authentication fails', async () => {
    const { adapter, requests } = fixture({ userId: null, authError: true });
    await expect(adapter.upsertApplication(input, 'user-1')).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(localStore.getApplications()).toEqual([]);
  });

  it('does not convert a signed-in operation to a guest operation after sign-out', async () => {
    const { adapter, requests } = fixture({ userId: null });
    await expect(adapter.upsertApplication(input, 'user-1')).rejects.toThrow();
    expect(requests).toEqual([]);
    expect(localStore.getApplications()).toEqual([]);
  });

  it('keeps the signed-in list separate from applications saved by a guest', async () => {
    localStore.upsertApplication({ ...input, roleId: 'guest-only-role' });
    const { adapter, requests } = fixture();
    expect(await adapter.listApplications('user-1')).toEqual([
      expect.objectContaining({ id: 'application-1', roleId: 'role-1' }),
    ]);
    expect(requests[0].url.searchParams.get('user_id')).toBe('eq.user-1');
    expect(localStore.getApplications()[0].roleId).toBe('guest-only-role');
  });

  it('upserts one tracked row per account and role and returns the persisted application', async () => {
    const { adapter, requests } = fixture();
    const saved = await adapter.upsertApplication(input, 'user-1');
    expect(saved).toMatchObject({ id: 'application-1', roleId: 'role-1', status: 'Applied' });
    const request = requests.find((item) => item.method === 'POST');
    expect(request?.url.pathname).toBe('/rest/v1/tracked_applications');
    expect(request?.url.searchParams.get('on_conflict')).toBe('user_id,role_id');
    expect(request?.body).toMatchObject({ user_id: 'user-1', role_id: 'role-1', status: 'Applied' });
    expect(localStore.getApplications()).toEqual([]);
  });

  it('updates by application id without clearing notes, dates, or URL omitted from a status change', async () => {
    const { adapter, requests } = fixture();
    await adapter.upsertApplication({ ...input, id: 'application-1', status: 'Interviewing' }, 'user-1');
    const request = requests.find((item) => item.method === 'PATCH');
    expect(request?.url.pathname).toBe('/rest/v1/tracked_applications');
    expect(request?.url.searchParams.get('id')).toBe('eq.application-1');
    expect(request?.url.searchParams.get('user_id')).toBe('eq.user-1');
    expect(request?.body).toMatchObject({ status: 'Interviewing' });
    for (const column of ['notes', 'application_url', 'applied_at', 'follow_up_date']) {
      expect(request?.body).not.toHaveProperty(column);
    }
  });

  it('propagates RLS insert failures without adding a misleading local copy', async () => {
    const { adapter } = fixture({ status: 403 });
    await expect(adapter.upsertApplication(input, 'user-1')).rejects.toMatchObject({ code: '42501' });
    expect(localStore.getApplications()).toEqual([]);
  });

  it('propagates RLS read failures instead of pretending there are no applications', async () => {
    const { adapter } = fixture({ status: 403 });
    await expect(adapter.listApplications('user-1')).rejects.toMatchObject({ code: '42501' });
  });

  it('checks the returned deleted id and scopes deletion to the current account', async () => {
    const { adapter, requests } = fixture({ rows: [{ id: 'application-1' }] });
    await adapter.deleteApplication('application-1', 'user-1');
    const request = requests.find((item) => item.method === 'DELETE');
    expect(request?.url.pathname).toBe('/rest/v1/tracked_applications');
    expect(request?.url.searchParams.get('id')).toBe('eq.application-1');
    expect(request?.url.searchParams.get('user_id')).toBe('eq.user-1');
    expect(request?.url.searchParams.get('select')).toBe('id');
  });

  it('reports a denied delete and leaves the independent guest data alone', async () => {
    const guest = localStore.upsertApplication(input);
    const { adapter } = fixture({ status: 403 });
    await expect(adapter.deleteApplication(guest.id, 'user-1')).rejects.toMatchObject({ code: '42501' });
    expect(localStore.getApplications()).toEqual([guest]);
  });

  it('rejects an RLS-filtered zero-row delete instead of claiming successful removal', async () => {
    const { adapter } = fixture({ rows: [] });
    await expect(adapter.deleteApplication('application-1', 'user-1')).rejects.toThrow();
  });
});
