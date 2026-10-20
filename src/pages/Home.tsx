import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { Search, MapPin, Map as MapIcon, Target, Send, Bookmark } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { Button } from '../components/ui/Button';
import { RoleCard } from '../components/cards/RoleCard';
import { CompanyCard } from '../components/cards/CompanyCard';
import { LoadingBlock } from '../components/ui/Spinner';
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
          content="Discover live internships, co-ops, and early-career opportunities at top companies, fast-growing teams, and public institutions, all in one place."
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
            Discover live internships, co-ops, and early-career opportunities at top companies,
            fast-growing teams, and public institutions, all in one place.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-3 text-left">
            <div className="flex flex-col gap-3 md:flex-row">
              <label className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-2 text-navy">
                <Search className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <span className="sr-only">Keyword</span>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Role, skill, or company"
                  className="w-full bg-transparent outline-none placeholder:text-slate-400"
                />
              </label>
              <label className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-2 text-navy">
                <MapPin className="h-5 w-5 text-slate-400" aria-hidden="true" />
                <span className="sr-only">Location</span>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City or Remote"
                  className="w-full bg-transparent outline-none placeholder:text-slate-400"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Quick term select">
              {QUICK_TERMS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTerm(t.value)}
                  aria-pressed={term === t.value}
                  className={
                    'rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
                    (term === t.value ? 'bg-cyan text-navy' : 'bg-white/10 text-white hover:bg-white/20')
                  }
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
          <LoadingBlock label="Loading featured opportunities" />
        ) : (
          <div className="space-y-10">
            <FeaturedRoles title="Recently verified internships" roles={featured.data?.recentlyVerified ?? []} />
            <FeaturedRoles title="Upcoming term opportunities" roles={featured.data?.byUpcomingTerm ?? []} />
            <FeaturedCompanies companies={featured.data?.featuredCompanies ?? []} />
          </div>
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
