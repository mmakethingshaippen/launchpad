import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdapter } from './useAdapter';
import type { ApplicationInput } from '../lib/adapter/types';

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

  return {
    applications: query.data ?? [],
    isLoading: query.isLoading,
    upsert: (input: ApplicationInput) => upsert.mutate(input),
    remove: (id: string) => remove.mutate(id),
  };
}
