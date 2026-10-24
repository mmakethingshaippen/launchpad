import { formatLocation } from '../lib/locationFormat';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Globe, MapPin, Map, ArrowLeft } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { useSaved } from '../hooks/useSaved';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { CompanyLogo } from '../components/ui/CompanyLogo';
import { TrackedRoleCard as RoleCard } from '../components/cards/TrackedRoleCard';
import { EmptyState } from '../components/ui/EmptyState';
import { CompanyProfileSkeleton } from '../components/ui/Skeleton';
import { SPECIFIC_SEASONS, type Season } from '../lib/adapter/types';
import { uniqueCompanyFields, visibleCompanyDescription } from '../lib/companyDisplay';

export function CompanyProfile() {
  const { slug = '' } = useParams();
  const adapter = useAdapter();
  const { savedIds, toggleSave } = useSaved();
  const [season, setSeason] = useState<Season | 'all'>('all');

  const { data: company, isLoading } = useQuery({
    queryKey: ['company', slug],
    queryFn: () => adapter.getCompany(slug),
  });

  if (isLoading) return <CompanyProfileSkeleton />;
  if (!company)
    return (
      <EmptyState
        title="Company not found"
        action={
          <Link to="/browse?view=companies">
            <Button variant="outline">Browse companies</Button>
          </Link>
        }
      />
    );

  const roles = season === 'all' ? company.roles : company.roles.filter((r) => r.seasons.includes(season));
  const description = visibleCompanyDescription(company.description);
  const fields = uniqueCompanyFields(company.fields);
  const mapHref = `/map?company=${encodeURIComponent(company.name)}`;

  return (
    <div>
      <Helmet>
        <title>{`${company.name} — Launchpad`}</title>
        <meta
          name="description"
          content={`Explore open internships and roles at ${company.name}.${description ? ` ${description}` : ''}`}
        />
        <meta property="og:title" content={`${company.name} on Launchpad`} />
      </Helmet>

      <Link
        to="/browse?view=companies"
        className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Browse companies
      </Link>

      {/* Header */}
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <CompanyLogo name={company.name} logoUrl={company.logoUrl} className="h-16 w-16 text-2xl" />
            <div>
              <h1 className="text-2xl font-bold text-navy">{company.name}</h1>
              {description && <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="cyan">{company.companyType}</Badge>
                {company.startupStage && <Badge tone="muted">{company.startupStage}</Badge>}
                {company.employeeCountRange && <Badge tone="muted">{company.employeeCountRange} employees</Badge>}
                {fields.map((f) => (
                  <Badge key={f} tone="muted">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 sm:flex-col">
            {company.websiteUrl && (
              <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="w-full">
                  <Globe className="h-4 w-4" aria-hidden="true" /> Website
                </Button>
              </a>
            )}
            {company.careersUrl && (
              <a href={company.careersUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="w-full">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Careers Page
                </Button>
              </a>
            )}
            <Link to={mapHref}>
              <Button variant="outline" size="sm" className="w-full">
                <Map className="h-4 w-4" aria-hidden="true" /> View on map
              </Button>
            </Link>
          </div>
        </div>

        {company.locations.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-medium text-slate-600">Locations:</span>
            {company.locations.map((loc) => (
              <span key={loc.id} className="rounded bg-slate-100 px-1.5 py-0.5">
                {formatLocation({ city: loc.city, state: loc.state, country: loc.country })}
                {loc.locationType === 'HQ' ? ' (HQ)' : ''}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Roles section */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy">
              Open opportunities ({roles.length}
              {season !== 'all' ? ` for ${season}` : ''})
            </h2>
            <p className="text-sm text-slate-500">Active postings, deduplicated by role title and location.</p>
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setSeason('all')}
              className={
                'rounded-full px-3 py-1 text-xs font-medium ' +
                (season === 'all' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
              }
            >
              All terms
            </button>
            {SPECIFIC_SEASONS.map((s) => (
              <button
                key={s}
                onClick={() => setSeason(s)}
                className={
                  'rounded-full px-3 py-1 text-xs font-medium ' +
                  (season === s ? 'bg-navy text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {roles.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title={`No ${season} opportunities`}
              description={`Check back later or view all opportunities at ${company.name}.`}
              action={
                season !== 'all' ? (
                  <Button variant="outline" onClick={() => setSeason('all')}>
                    View all terms
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {roles.map((r) => (
              <RoleCard key={r.id} role={r} saved={savedIds.has(r.id)} onToggleSave={toggleSave} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
