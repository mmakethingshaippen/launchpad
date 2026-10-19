import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdapter } from './useAdapter';

export function useSaved() {
  const adapter = useAdapter();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['saved'],
    queryFn: () => adapter.listSaved(),
  });

  const savedIds = new Set((query.data ?? []).map((s) => s.roleId));

  const toggle = useMutation({
    mutationFn: async (roleId: string) => {
      if (savedIds.has(roleId)) await adapter.unsave(roleId);
      else await adapter.save(roleId);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved'] }),
  });

  return {
    saved: query.data ?? [],
    savedIds,
    isLoading: query.isLoading,
    toggleSave: (roleId: string) => toggle.mutate(roleId),
  };
}
