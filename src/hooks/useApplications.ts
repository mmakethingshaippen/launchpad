import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdapter } from './useAdapter';
import type { ApplicationInput, ApplicationStatus } from '../lib/adapter/types';

export function useApplications() {
  const adapter = useAdapter();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['applications'],
    queryFn: () => adapter.listApplications(),
  });

  const upsert = useMutation({
    mutationFn: (input: ApplicationInput) => adapter.upsertApplication(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adapter.deleteApplication(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['applications'] }),
  });

  const toggleTrack = async (
    role: { id: string; companyName: string; title: string; applyUrl?: string | null },
    status: ApplicationStatus = 'Applied',
  ) => {
    const existing = (query.data ?? []).find(
      (a) =>
        a.roleId === role.id ||
        (a.companyName.toLowerCase() === role.companyName.toLowerCase() &&
          a.roleTitle.toLowerCase() === role.title.toLowerCase()),
    );
    if (existing) {
      await remove.mutateAsync(existing.id);
    } else {
      await upsert.mutateAsync({
        roleId: role.id,
        companyName: role.companyName,
        roleTitle: role.title,
        status,
        applicationUrl: role.applyUrl ?? null,
      });
    }
  };

  return {
    applications: query.data ?? [],
    isLoading: query.isLoading,
    isSaving: upsert.isPending || remove.isPending,
    upsert: (input: ApplicationInput) => upsert.mutate(input),
    upsertAsync: (input: ApplicationInput) => upsert.mutateAsync(input),
    remove: (id: string) => remove.mutate(id),
    removeAsync: (id: string) => remove.mutateAsync(id),
    toggleTrack,
  };
}
