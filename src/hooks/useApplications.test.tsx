import type { ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterProvider } from './useAdapter';
import { AuthProvider, type AuthState } from './useAuth';
import { useApplications } from './useApplications';
import type { DataAdapter } from '../lib/adapter';
import type { Application, ApplicationInput } from '../lib/adapter/types';

const role = (id: string) => ({ id, companyName: 'Example', title: 'Engineering Intern' });

function application(roleId: string, overrides: Partial<Application> = {}): Application {
  return {
    id: `persisted-${roleId}`, roleId, companyName: 'Example', roleTitle: 'Engineering Intern',
    status: 'Applied', notes: null, applicationUrl: null, appliedAt: null, followUpDate: null,
    createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z', ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function auth(owner: string | null): AuthState {
  return {
    user: owner ? { id: owner, email: `${owner}@example.com`, accountRole: 'student' } : null,
    loading: false, isCloud: true, signIn: async () => {}, signOut: async () => {},
    signUp: async () => ({ needsConfirmation: false }), resetPasswordForEmail: async () => {},
    updatePassword: async () => {},
  };
}

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

function harness(initialOwner: string | null = null, initial: Application[] = []) {
  let owner = initialOwner;
  const records = new Map<string | null, Application[]>([[owner, initial]]);
  const saveDelays = new Map<string, ReturnType<typeof deferred>>();
  const deleteDelays = new Map<string, ReturnType<typeof deferred>>();
  const listApplications = vi.fn(async (expectedUserId?: string | null) => [...(records.get(expectedUserId ?? null) ?? [])]);
  const upsertApplication = vi.fn(async (input: ApplicationInput, expectedUserId?: string | null) => {
    await saveDelays.get(input.roleId!)?.promise;
    const account = expectedUserId ?? null;
    const saved = application(input.roleId!, {
      ...(input.id ? { id: input.id } : {}), companyName: input.companyName, roleTitle: input.roleTitle,
      status: input.status ?? 'Applied', notes: input.notes ?? null, applicationUrl: input.applicationUrl ?? null,
    });
    records.set(account, [saved, ...(records.get(account) ?? []).filter(item => item.roleId !== saved.roleId)]);
    return saved;
  });
  const deleteApplication = vi.fn(async (id: string, expectedUserId?: string | null) => {
    await deleteDelays.get(id)?.promise;
    const account = expectedUserId ?? null;
    records.set(account, (records.get(account) ?? []).filter(item => item.id !== id));
  });
  const adapter = { listApplications, upsertApplication, deleteApplication } as unknown as DataAdapter;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider value={auth(owner)}>
        <AdapterProvider adapter={adapter}>{children}</AdapterProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => ({ card: useApplications(), applicationsPage: useApplications() }), { wrapper: Wrapper });
  return {
    ...hook, records, saveDelays, deleteDelays, listApplications, upsertApplication, deleteApplication,
    switchAccount(next: string | null) { owner = next; hook.rerender(); },
    async ready() { await waitFor(() => expect(hook.result.current.card.canEdit).toBe(true)); },
  };
}

describe('shared application tracking state', () => {
  it('shows a tracked job in every consumer before saving finishes, then uses its persisted id', async () => {
    const test = harness();
    const saving = deferred();
    test.saveDelays.set('role-1', saving);
    await test.ready();
    let operation!: Promise<void>;
    act(() => { operation = test.result.current.card.toggleTrack(role('role-1')); });
    await waitFor(() => {
      expect(test.result.current.card.applications).toHaveLength(1);
      expect(test.result.current.applicationsPage.applications).toHaveLength(1);
      expect(test.result.current.card.isRolePending('role-1')).toBe(true);
      expect(test.result.current.applicationsPage.isRolePending('role-1')).toBe(true);
    });
    expect(test.records.get(null)).toEqual([]);
    expect(test.result.current.card.applications[0].id).not.toBe('persisted-role-1');
    await act(async () => { saving.resolve(); await operation; });
    await waitFor(() => expect(test.result.current.applicationsPage.applications[0].id).toBe('persisted-role-1'));
    expect(test.upsertApplication).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'role-1' }), null);
    await waitFor(() => expect(test.result.current.card.isRolePending('role-1')).toBe(false));
  });

  it('removes a tracked job from every consumer before deletion finishes', async () => {
    const saved = application('role-1');
    const test = harness(null, [saved]);
    const deleting = deferred();
    test.deleteDelays.set(saved.id, deleting);
    await test.ready();
    let operation!: Promise<void>;
    act(() => { operation = test.result.current.card.toggleTrack(role('role-1')); });
    await waitFor(() => {
      expect(test.result.current.card.applications).toEqual([]);
      expect(test.result.current.applicationsPage.applications).toEqual([]);
      expect(test.result.current.card.isRolePending('role-1')).toBe(true);
    });
    expect(test.records.get(null)).toEqual([saved]);
    await act(async () => { deleting.resolve(); await operation; });
    expect(test.deleteApplication).toHaveBeenCalledWith(saved.id, null);
    expect(test.records.get(null)).toEqual([]);
  });

  it('rolls back a failed job without undoing a different successful track', async () => {
    const test = harness();
    const first = deferred();
    const second = deferred();
    test.saveDelays.set('role-1', first);
    test.saveDelays.set('role-2', second);
    await test.ready();
    let failure!: Promise<unknown>;
    let success!: Promise<void>;
    act(() => { failure = test.result.current.card.toggleTrack(role('role-1')).catch(error => error); });
    await waitFor(() => expect(test.result.current.card.applications).toHaveLength(1));
    act(() => { success = test.result.current.card.toggleTrack(role('role-2')); });
    await waitFor(() => expect(test.result.current.applicationsPage.applications).toHaveLength(2));
    await act(async () => { second.resolve(); await success; });
    await act(async () => { first.reject(new Error('Could not save this role')); await failure; });
    await waitFor(() => {
      expect(test.result.current.card.applications.map(item => item.roleId)).toEqual(['role-2']);
      expect(test.result.current.applicationsPage.applications.map(item => item.roleId)).toEqual(['role-2']);
    });
    expect(test.records.get(null)?.map(item => item.roleId)).toEqual(['role-2']);
    expect(test.result.current.card.error).toContain('Could not save this role');
    expect(test.result.current.card.errorKey).toBe('role:role-1');
  });

  it('restores a failed removal and exposes the failure to both consumers', async () => {
    const saved = application('role-1', { notes: 'Do not lose my note' });
    const test = harness(null, [saved]);
    const deleting = deferred();
    test.deleteDelays.set(saved.id, deleting);
    await test.ready();
    let operation!: Promise<unknown>;
    act(() => { operation = test.result.current.card.toggleTrack(role('role-1')).catch(error => error); });
    await waitFor(() => expect(test.result.current.applicationsPage.applications).toEqual([]));
    await act(async () => { deleting.reject(new Error('Could not remove application')); await operation; });
    await waitFor(() => {
      expect(test.result.current.applicationsPage.applications).toEqual([saved]);
      expect(test.result.current.card.error).toContain('Could not remove application');
      expect(test.result.current.applicationsPage.error).toContain('Could not remove application');
    });
  });

  it('ignores simultaneous duplicate clicks from different consumers while one job is pending', async () => {
    const test = harness();
    const saving = deferred();
    test.saveDelays.set('role-1', saving);
    await test.ready();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = test.result.current.card.toggleTrack(role('role-1'));
      second = test.result.current.applicationsPage.toggleTrack(role('role-1'));
    });
    await waitFor(() => expect(test.upsertApplication).toHaveBeenCalledTimes(1));
    expect(test.deleteApplication).not.toHaveBeenCalled();
    expect(test.result.current.card.applications).toHaveLength(1);
    await act(async () => { saving.resolve(); await Promise.all([first, second]); });
    expect(test.records.get(null)).toHaveLength(1);
  });

  it('treats jobs with the same company and title but different role ids independently', async () => {
    const test = harness();
    await test.ready();
    await act(async () => { await test.result.current.card.toggleTrack(role('role-1')); });
    await act(async () => { await test.result.current.card.toggleTrack(role('role-2')); });
    await waitFor(() => expect(test.result.current.applicationsPage.applications).toHaveLength(2));
    await act(async () => { await test.result.current.card.toggleTrack(role('role-1')); });
    await waitFor(() => expect(test.result.current.applicationsPage.applications.map(item => item.roleId)).toEqual(['role-2']));
  });

  it('keeps an in-flight save scoped to its original account after an account switch', async () => {
    const test = harness('user-1', [application('first-user-role')]);
    test.records.set('user-2', [application('second-user-role')]);
    const saving = deferred();
    test.saveDelays.set('new-role', saving);
    await test.ready();
    let operation!: Promise<void>;
    act(() => { operation = test.result.current.card.toggleTrack(role('new-role')); });
    await waitFor(() => expect(test.result.current.card.applications).toHaveLength(2));
    act(() => test.switchAccount('user-2'));
    await test.ready();
    await waitFor(() => expect(test.result.current.card.applications.map(item => item.roleId)).toEqual(['second-user-role']));
    expect(test.result.current.card.isRolePending('new-role')).toBe(false);
    await act(async () => { saving.resolve(); await operation; });
    expect(test.result.current.applicationsPage.applications.map(item => item.roleId)).toEqual(['second-user-role']);
    expect(test.upsertApplication).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'new-role' }), 'user-1');
    act(() => test.switchAccount('user-1'));
    await test.ready();
    await waitFor(() => expect(test.result.current.card.applications.map(item => item.roleId).sort()).toEqual(['first-user-role', 'new-role']));
    expect(test.result.current.card.applications.find(item => item.roleId === 'new-role')?.id).toBe('persisted-new-role');
  });
});
