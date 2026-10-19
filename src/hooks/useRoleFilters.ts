import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  parseFilters,
  serializeFilters,
  activeFilterCount,
  DEFAULT_FILTERS,
  type RoleFilters,
} from '../lib/filters';

export interface UseRoleFilters {
  filters: RoleFilters;
  activeCount: number;
  setFilters: (next: Partial<RoleFilters>) => void;
  replaceFilters: (next: RoleFilters) => void;
  toggleSeason: (season: RoleFilters['seasons'][number]) => void;
  clearAll: () => void;
}

/**
 * URL is the source of truth for discovery filters (Req 6.4-6.5). This hook
 * reads/writes RoleFilters to the query string via useSearchParams.
 */
export function useRoleFilters(): UseRoleFilters {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => parseFilters(params), [params]);
  const activeCount = useMemo(() => activeFilterCount(filters), [filters]);

  const replaceFilters = useCallback(
    (next: RoleFilters) => {
      // Reset to page 1 whenever filters change meaningfully.
      setParams(serializeFilters({ ...next }), { replace: false });
    },
    [setParams],
  );

  const setFilters = useCallback(
    (patch: Partial<RoleFilters>) => {
      const next: RoleFilters = { ...filters, ...patch };
      // any change other than an explicit page change resets to page 1
      if (!('page' in patch)) next.page = 1;
      setParams(serializeFilters(next));
    },
    [filters, setParams],
  );

  const toggleSeason = useCallback(
    (season: RoleFilters['seasons'][number]) => {
      const exists = filters.seasons.includes(season);
      const seasons = exists
        ? filters.seasons.filter((s) => s !== season)
        : [...filters.seasons, season];
      setFilters({ seasons });
    },
    [filters.seasons, setFilters],
  );

  const clearAll = useCallback(() => {
    setParams(serializeFilters({ ...DEFAULT_FILTERS, view: filters.view }));
  }, [filters.view, setParams]);

  return { filters, activeCount, setFilters, replaceFilters, toggleSeason, clearAll };
}
