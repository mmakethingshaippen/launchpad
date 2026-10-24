import { useEffect } from 'react';
import { useQuery, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useAdapter } from './useAdapter';
import { useAuth } from './useAuth';
import { APPS_KEY } from '../lib/localStore';
import type { Application, ApplicationInput, ApplicationStatus } from '../lib/adapter/types';

const mutationKey = ['application-change'];
const queryKey = (owner: string | null) => ['applications', owner ?? 'guest'];
const recordKey = (a: { id?: string; roleId?: string | null; companyName: string; roleTitle: string }) =>
  a.roleId ? `role:${a.roleId}` : `manual:${JSON.stringify([a.companyName.trim().toLowerCase(), a.roleTitle.trim().toLowerCase()])}`;

type Change = {
  owner: string | null;
  key: string;
  previous?: Application;
  optimistic?: Application;
  input?: ApplicationInput;
};

function message(error: unknown): string | null {
  if (!error) return null;
  const detail = typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  if (/row.level security|permission denied|42501/i.test(detail)) {
    return 'Your account could not update this application. Sign in again and retry, or contact support.';
  }
  if (/tracked_applications.*(does not exist|schema cache)/i.test(detail)) {
    return 'Application tracking is temporarily unavailable. Please try again later.';
  }
  return detail;
}

/** All consumers share the same account-scoped cache and pending mutations. */
export function useApplications() {
  const adapter = useAdapter();
  const { user, loading: authLoading, isCloud, authError, refreshSession } = useAuth();
  const owner = isCloud ? user?.id ?? null : null;
  const qc = useQueryClient();
  const key = queryKey(owner);
  const query = useQuery({
    queryKey: key,
    enabled: !authLoading && !authError,
    queryFn: async ({ signal }) => {
      const applications = await adapter.listApplications(owner);
      signal.throwIfAborted();
      return applications;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (owner !== null) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPS_KEY || event.key === null) {
        void qc.invalidateQueries({ queryKey: queryKey(null), exact: true });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [owner, qc]);

  const mutations = useMutationState({
    filters: { mutationKey },
    select: (mutation) => ({
      change: mutation.state.variables as Change | undefined,
      status: mutation.state.status,
      error: mutation.state.error,
      time: mutation.state.submittedAt,
    }),
  }).filter(mutation => mutation.change?.owner === owner);
  const pending = mutations.filter(mutation => mutation.status === 'pending');
  const latestByRecord = new Map<string, (typeof mutations)[number]>();
  for (const item of mutations) if (item.change) latestByRecord.set(item.change.key, item);
  // A successful save for a different job must not hide a failed operation.
  const failed = [...latestByRecord.values()].filter(item => item.status === 'error').at(-1);

  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: (change: Change) => change.input
      ? adapter.upsertApplication(change.input, change.owner)
      : adapter.deleteApplication(change.previous!.id, change.owner),
    onMutate: async (change) => {
      await qc.cancelQueries({ queryKey: queryKey(change.owner), exact: true });
      qc.setQueryData<Application[]>(queryKey(change.owner), (items = []) => {
        const rest = items.filter(item => item.id !== change.previous?.id && item.id !== change.optimistic?.id);
        return change.optimistic ? [change.optimistic, ...rest] : rest;
      });
    },
    onSuccess: (saved, change) => {
      if (!saved) return;
      qc.setQueryData<Application[]>(queryKey(change.owner), (items = []) => [
        saved, ...items.filter(item => item.id !== change.optimistic?.id && item.id !== saved.id),
      ]);
    },
    onError: (_error, change) => {
      // Roll back this record only; leave successful changes to other jobs intact.
      qc.setQueryData<Application[]>(queryKey(change.owner), (items = []) => {
        const rest = items.filter(item => item.id !== change.optimistic?.id && item.id !== change.previous?.id);
        return change.previous ? [change.previous, ...rest] : rest;
      });
    },
    onSettled: (_data, _error, change) => {
      if (qc.isMutating({ mutationKey, predicate: m => (m.state.variables as Change)?.owner === change.owner }) === 1) {
        void qc.invalidateQueries({ queryKey: queryKey(change.owner), exact: true });
      }
    },
  });

  const run = async (change: Change) => {
    if (authLoading || authError || !query.isSuccess) throw new Error('Wait for your applications to load, then retry.');
    // The cache changes synchronously, preventing clicks in two consumers
    // before React has rendered their disabled buttons.
    if (qc.isMutating({ mutationKey, predicate: m => {
      const active = m.state.variables as Change;
      return active?.owner === change.owner && active.key === change.key;
    } })) return;
    await mutation.mutateAsync(change);
  };
  const current = () => qc.getQueryData<Application[]>(key) ?? [];
  const upsertAsync = async (input: ApplicationInput) => {
    const previous = current().find(a => input.id ? a.id === input.id : input.roleId
      ? a.roleId === input.roleId
      : !a.roleId && a.companyName.trim().toLowerCase() === input.companyName.trim().toLowerCase() && a.roleTitle.trim().toLowerCase() === input.roleTitle.trim().toLowerCase());
    const now = new Date().toISOString();
    const optimistic: Application = {
      id: previous?.id ?? crypto.randomUUID(), roleId: input.roleId ?? previous?.roleId ?? null,
      companyName: input.companyName.trim(), roleTitle: input.roleTitle.trim(),
      status: input.status ?? previous?.status ?? 'Applied',
      notes: input.notes !== undefined ? input.notes : previous?.notes ?? null,
      applicationUrl: input.applicationUrl !== undefined ? input.applicationUrl : previous?.applicationUrl ?? null,
      appliedAt: input.appliedAt !== undefined ? input.appliedAt : previous?.appliedAt ?? null,
      followUpDate: input.followUpDate !== undefined ? input.followUpDate : previous?.followUpDate ?? null,
      createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    await run({ owner, key: recordKey(previous ?? input), previous, optimistic,
      input: { ...input, ...(previous ? { id: previous.id } : {}) } });
  };
  const removeAsync = async (id: string) => {
    const previous = current().find(a => a.id === id);
    if (previous) await run({ owner, key: recordKey(previous), previous });
  };
  const toggleTrack = async (
    role: { id: string; companyName: string; title: string; applyUrl?: string | null },
    status: ApplicationStatus = 'Applied',
  ) => {
    const existing = current().find(a => a.roleId === role.id);
    if (existing) await removeAsync(existing.id);
    else await upsertAsync({ roleId: role.id, companyName: role.companyName,
      roleTitle: role.title, status, applicationUrl: role.applyUrl ?? null });
  };

  return {
    applications: authLoading ? [] : query.data ?? [],
    isLoading: !authError && (authLoading || query.isPending),
    isSaving: pending.length > 0,
    canEdit: !authLoading && !authError && query.isSuccess,
    isRolePending: (id: string) => pending.some(m => m.change?.key === `role:${id}`),
    isApplicationPending: (application: Application) => pending.some(m => m.change?.key === recordKey(application)),
    error: authError ?? message(query.error) ?? message(failed?.error),
    errorKey: failed?.change?.key,
    retry: () => { if (authError) void refreshSession?.(); else void query.refetch(); },
    // Event handlers consume failures; the error remains visible in shared state.
    upsert: (input: ApplicationInput) => { void upsertAsync(input).catch(() => {}); },
    remove: (id: string) => { void removeAsync(id).catch(() => {}); },
    upsertAsync, removeAsync, toggleTrack,
  };
}
