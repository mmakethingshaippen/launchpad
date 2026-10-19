import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useRoleFilters } from './useRoleFilters';

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useRoleFilters', () => {
  it('restores filter state from the URL', () => {
    const { result } = renderHook(() => useRoleFilters(), {
      wrapper: wrapper('/browse?q=engineer&season=summer,fall&type=internship&remote=1'),
    });
    expect(result.current.filters.keyword).toBe('engineer');
    expect(result.current.filters.seasons.sort()).toEqual(['Fall', 'Summer']);
    expect(result.current.filters.opportunityTypes).toEqual(['internship']);
    expect(result.current.filters.remoteOnly).toBe(true);
    expect(result.current.activeCount).toBe(4);
  });

  it('toggles a season and resets to page 1', () => {
    const { result } = renderHook(() => useRoleFilters(), { wrapper: wrapper('/browse?page=3') });
    act(() => result.current.toggleSeason('Summer'));
    expect(result.current.filters.seasons).toEqual(['Summer']);
    expect(result.current.filters.page).toBe(1);
  });

  it('clears all filters but keeps the current view', () => {
    const { result } = renderHook(() => useRoleFilters(), {
      wrapper: wrapper('/browse?q=x&season=summer&view=companies'),
    });
    act(() => result.current.clearAll());
    expect(result.current.activeCount).toBe(0);
    expect(result.current.filters.view).toBe('companies');
  });
});
