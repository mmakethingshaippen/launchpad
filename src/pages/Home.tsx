import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, Map as MapIcon, Target, Send, Bookmark } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { Button } from '../components/ui/Button';
import { TrackedRoleCard as RoleCard } from '../components/cards/TrackedRoleCard';
import { CompanyCard } from '../components/cards/CompanyCard';
import { RoleCardSkeleton } from '../components/ui/Skeleton';
import type { Season } from '../lib/adapter/types';

const QUICK_TERMS: Array<{ label: string; value: Season | 'all' }> = [
  { label: 'All Terms', value: 'all' },
  { label: 'Summer', value: 'Summer' },
  { label: 'Fall', value: 'Fall' },
  { label: 'Winter', value: 'Winter' },
  { label: 'Spring', value: 'Spring' },
];

export function Home() {
  const adapter = useAdapter();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [term, setTerm] = useState<Season | 'all'>('all');
  const [location, setLocation] = useState('');

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => adapter.getStats() });
  const featured = useQuery({ queryKey: ['featured'], queryFn: () => adapter.getFeatured() });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (keyword) params.set('q', keyword);
    if (term !== 'all') params.set('season', term.toLowerCase());
    if (location) params.set('city', location);
    navigate(`/browse?${params.toString()}`);
  };

  return (
    <div>
      <Helmet>
        <title>Launchpad — Your career starts somewhere</title>
        <meta
          name="description"
          content="Discover live internships, co-ops, and early career opportunities at top companies, fast growing teams, and public institutions, all in one place."
        />
        <meta property="og:title" content="Launchpad — Find your Launchpad" />
      </Helmet>

      {/* Hero */}
      <section className="rounded-2xl bg-navy px-6 py-14 text-white md:px-12">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-3xl font-bold tracking-tight md:text-5xl">
            Your career starts somewhere. Find your <span className="text-cyan">Launchpad</span>.
          </h1>
          <p className="mt-4 text-base text-slate-300 md:text-lg">
            Discover live internships, co-ops, and early career opportunities at top companies,
            fast growing teams, and public institutions, all in one place.
          </p>

          {/* Search bar */}
          <form
            onSubmit={submit}
            className="mt-8 flex flex-col gap-3 rounded-xl bg-white p-3 text-slate-900 shadow-xl"
            role="search"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2 px-3 py-1">
                <Search className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Role, skill, or keyword (e.g. Software, Data, Finance)"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-full text-sm outline-none placeholder:text-slate-400"
                  aria-label="Search keywords"
                />
              </div>

              <div className="h-px bg-slate-200 sm:h-6 sm:w-px" />

              <div className="flex flex-1 items-center gap-2 px-3 py-1">
                <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="City, state, or 'Remote'"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-sm outline-none placeholder:text-slate-400"
                  aria-label="Location"
                />
              </div>
            </div>

            {/* Quick term selector */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2 text-xs">
              <span className="text-slate-500 font-medium mr-1">Term:</span>
              {QUICK_TERMS.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  onClick={() => setTerm(t.value)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    term === t.value
                      ? 'bg-navy text-white font-medium'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row">
              <Button type="submit" size="lg" className="flex-1">
                <Search className="h-5 w-5" aria-hidden="true" /> Find Opportunities
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="flex-1 border-white/30 text-white hover:bg-white/10"
                onClick={() => navigate('/map')}
              >
                <MapIcon className="h-5 w-5" aria-hidden="true" /> Explore Interactive Map
              </Button>
            </div>
          </form>
        </div>
      </section>

      {/* Stats */}
      <section className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Launchpad statistics">
        {[
          { label: 'Companies listed', value: stats.data?.companies },
          { label: 'Active, verified opportunities', value: stats.data?.activeRoles },
          { label: 'Cities & hubs mapped', value: stats.data?.cities },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-3xl font-bold text-navy">{s.value ?? '—'}</p>
            <p className="mt-1 text-sm text-slate-500">{s.label}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="mt-12">
        <h2 className="text-center text-2xl font-bold text-navy">How It Works</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: Target, title: 'Discover', body: 'Live opportunities that match your field and target term.' },
            { icon: Send, title: 'Apply', body: "Directly through the employer's active application page." },
            { icon: Bookmark, title: 'Track', body: 'Save and track your applications in one place.' },
          ].map((step, i) => (
            <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
                <step.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-3 font-semibold text-navy">
                {i + 1}. {step.title}
              </h3>
              <p className="mt-1 text-sm text-slate-500">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured */}
      <section className="mt-12">
        {featured.isLoading ? (
          <div className="space-y-10">
            <div>
              <div className="mb-4 h-6 w-64 rounded bg-slate-200 animate-pulse" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <RoleCardSkeleton key={i} />
                ))}
              </div>
            </div>
            <div>
              <div className="mb-4 h-6 w-64 rounded bg-slate-200 animate-pulse" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <RoleCardSkeleton key={i} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          (() => {
            const recentRoles = (featured.data?.recentlyVerified ?? []).slice(0, 3);
            const seenIds = new Set(recentRoles.map((r) => r.id));
            const upcomingRoles = (featured.data?.byUpcomingTerm ?? [])
              .filter((r) => !seenIds.has(r.id))
              .slice(0, 3);

            return (
              <div className="space-y-10">
                <FeaturedRoles title="Recently verified internships" roles={recentRoles} />
                <FeaturedRoles title="Upcoming term opportunities" roles={upcomingRoles} />
                <FeaturedCompanies companies={featured.data?.featuredCompanies ?? []} />
              </div>
            );
          })()
        )}
      </section>
    </div>
  );
}

function FeaturedRoles({ title, roles }: { title: string; roles: import('../lib/adapter/types').RoleCard[] }) {
  if (!roles.length) return null;
  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-navy">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {roles.slice(0, 3).map((r) => (
          <RoleCard key={r.id} role={r} />
        ))}
      </div>
    </div>
  );
}

function FeaturedCompanies({ companies }: { companies: import('../lib/adapter/types').CompanyCard[] }) {
  if (!companies.length) return null;
  return (
    <div>
      <h2 className="mb-4 text-xl font-bold text-navy">Featured companies</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {companies.slice(0, 3).map((c) => (
          <CompanyCard key={c.id} company={c} />
        ))}
      </div>
    </div>
  );
}
