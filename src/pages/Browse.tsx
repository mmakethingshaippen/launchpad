import { useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal, LayoutGrid, Building2 } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { useRoleFilters } from '../hooks/useRoleFilters';
import { useSaved } from '../hooks/useSaved';
import { useApplications } from '../hooks/useApplications';
import type { ApplicationStatus, RoleCard as RoleCardData } from '../lib/adapter/types';
import { FilterPanel } from '../components/browse/FilterPanel';
import { ActiveChips } from '../components/browse/ActiveChips';
import { Pagination } from '../components/browse/Pagination';
import { RoleCard } from '../components/cards/RoleCard';
import { CompanyCard } from '../components/cards/CompanyCard';
import { Drawer } from '../components/ui/Drawer';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
import { interleaveByCompany } from '../lib/roleQuery';
import type { SortKey } from '../lib/filters';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'verified', label: 'Most recently verified' },
  { value: 'recent', label: 'Recently added' },
  { value: 'deadline', label: 'Deadline: soonest' },
  { value: 'name', label: 'Company name' },
  { value: 'relevance', label: 'Relevance' },
];

export function Browse() {
  const adapter = useAdapter();
  const { filters, activeCount, setFilters, clearAll } = useRoleFilters();
  const { savedIds, toggleSave } = useSaved();
  const { applications, toggleTrack } = useApplications();
  const [trackingRoleId, setTrackingRoleId] = useState<string | null>(null);
  const trackedIds = new Set(applications.map((application) => application.roleId).filter((id): id is string => Boolean(id)));
  const handleToggleTrack = async (role: RoleCardData) => {
    setTrackingRoleId(role.id);
    try {
      await toggleTrack({
        id: role.id,
        companyName: role.companyName,
        title: role.title,
        applyUrl: role.applyUrl ?? null,
      });
    } finally {
      setTrackingRoleId(null);
    }
  };
  const [drawerOpen, setDrawerOpen] = useState(false);

  const roleQuery = useQuery({
    queryKey: ['roles', filters],
    queryFn: () => adapter.searchRoles(filters),
    enabled: filters.view === 'opportunities',
  });
  const companyQuery = useQuery({
    queryKey: ['companies', filters],
    queryFn: () => adapter.searchCompanies(filters),
    enabled: filters.view === 'companies',
  });

  const isCompanies = filters.view === 'companies';
  const activeQuery = isCompanies ? companyQuery : roleQuery;
  const total = activeQuery.data?.total ?? 0;
  const pageSize = activeQuery.data?.pageSize ?? 21;
  const loading = activeQuery.isLoading;
  const gridRef = useRef<HTMLDivElement>(null);

  const goToPage = (page: number) => {
    setFilters({ page });
    // Smoothly return to the top of the results grid on page change.
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div>
      <Helmet>
        <title>Browse opportunities — Launchpad</title>
        <meta name="description" content="Filter live internships and early-career roles by season, field, location, and more." />
      </Helmet>

      <div className="flex gap-6">
        {/* Sidebar (desktop) */}
        <aside className="hidden w-72 flex-shrink-0 lg:block">
          <div className="sticky top-20 rounded-xl border border-slate-200 bg-white p-4">
            <FilterPanel filters={filters} onChange={setFilters} />
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setDrawerOpen(true)}>
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
                {activeCount > 0 && <span className="ml-1 rounded-full bg-cyan px-1.5 text-xs text-navy">{activeCount}</span>}
              </Button>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="tablist" aria-label="View">
                <button
                  role="tab"
                  aria-selected={!isCompanies}
                  onClick={() => setFilters({ view: 'opportunities' })}
                  className={'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ' + (!isCompanies ? 'bg-navy text-white' : 'text-slate-600')}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Opportunities
                </button>
                <button
                  role="tab"
                  aria-selected={isCompanies}
                  onClick={() => setFilters({ view: 'companies' })}
                  className={'flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium ' + (isCompanies ? 'bg-navy text-white' : 'text-slate-600')}
                >
                  <Building2 className="h-4 w-4" aria-hidden="true" /> Companies
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="sr-only">Sort by</span>
              Sort:
              <select
                value={filters.sort}
                onChange={(e) => setFilters({ sort: e.target.value as SortKey })}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-cyan"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mb-3">
            <ActiveChips filters={filters} onChange={setFilters} onClearAll={clearAll} />
          </div>

          <p className="mb-4 text-sm text-slate-500" aria-live="polite">
            {loading ? 'Searching…' : `${total.toLocaleString()} matching ${isCompanies ? 'companies' : 'active opportunities'}`}
          </p>

          {loading ? (
            <LoadingBlock />
          ) : total === 0 ? (
            <EmptyState
              title="No results match your filters"
              description="Try removing a filter or broadening your search."
              action={
                activeCount > 0 ? (
                  <Button variant="outline" onClick={clearAll}>
                    Clear all filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div ref={gridRef}>
              {isCompanies ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {companyQuery.data!.items.map((c) => (
                    <CompanyCard key={c.id} company={c} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {(filters.sort === 'verified'
                    ? interleaveByCompany(roleQuery.data!.items)
                    : roleQuery.data!.items
                  ).map((r) => (
                    <RoleCard key={r.id} role={r} saved={savedIds.has(r.id)} onToggleSave={toggleSave} tracked={trackedIds.has(r.id)} trackingSaving={trackingRoleId === r.id} onToggleTrack={handleToggleTrack} onTrack={(_id) => { void handleToggleTrack(r); }} />
                  ))}
                </div>
              )}

              <Pagination
                page={filters.page}
                pageSize={pageSize}
                total={total}
                noun={isCompanies ? 'companies' : 'opportunities'}
                onPageChange={goToPage}
              />
            </div>
          )}
        </div>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Filters">
        <FilterPanel filters={filters} onChange={setFilters} />
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => setDrawerOpen(false)}>
            Show {total} results
          </Button>
          <Button variant="outline" onClick={clearAll}>
            Clear
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
