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
import { RoleCard } from '../components/cards/RoleCard';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingBlock } from '../components/ui/Spinner';
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

  if (isLoading) return <LoadingBlock label="Loading company" />;
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
    <div className="mx-auto max-w-4xl">
      <Helmet>
        <title>{`${company.name} — Launchpad`}</title>
        <meta name="description" content={description ?? `${company.name} opportunities on Launchpad`} />
        <meta property="og:title" content={`${company.name} on Launchpad`} />
      </Helmet>

      <Link to="/browse?view=companies" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to companies
      </Link>

      <header className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <CompanyLogo
            name={company.name}
            logoUrl={company.logoUrl}
            websiteUrl={company.websiteUrl}
            size={64}
            className="rounded-xl"
          />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-navy">{company.name}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={company.companyType === 'Startup' ? 'cyan' : 'muted'}>{company.companyType}</Badge>
              {fields.map((f) => (
                <Badge key={f} tone="muted">
                  {f}
                </Badge>
              ))}
              {company.startupStage && company.startupStage !== 'Unknown / Not disclosed' && (
                <Badge tone="muted">{company.startupStage}</Badge>
              )}
              {company.employeeCountRange && <Badge tone="muted">{company.employeeCountRange} employees</Badge>}
              {company.foundingYear && <Badge tone="muted">Founded {company.foundingYear}</Badge>}
            </div>
          </div>
        </div>

        {description && <p className="mt-4 text-slate-600">{description}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          {company.websiteUrl && (
            <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-600 hover:text-navy">
              <Globe className="h-4 w-4" aria-hidden="true" /> Website
            </a>
          )}
          {company.careersUrl && (
            <a href={company.careersUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-slate-600 hover:text-navy">
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Careers page
            </a>
          )}
          {company.activeRoleCount > 0 && (
            <Link
              to={mapHref}
              className="inline-flex items-center gap-1 font-medium text-navy hover:text-cyan"
            >

<Map className="h-4 w-4 text-cyan" aria-hidden="true" />
View pins on map
            </Link>
          )}
          {company.locations[0] && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {[company.locations[0].city, company.locations[0].state, company.locations[0].country].filter(Boolean).join(', ')}
            </span>
          )}
        </div>
      </header>

      <section className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-navy">
            {company.activeRoleCount} active {company.activeRoleCount === 1 ? 'opportunity' : 'opportunities'}
          </h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by season">
            <SeasonFilterButton label="All" active={season === 'all'} onClick={() => setSeason('all')} />
            {SPECIFIC_SEASONS.map((s) => (
              <SeasonFilterButton key={s} label={s} active={season === s} onClick={() => setSeason(s)} />
            ))}
          </div>
        </div>

        {company.activeRoleCount === 0 ? (
          <EmptyState
            title="No open roles right now"
            description={`${company.name} has no active listings today. Check their careers page for the latest.`}
            action={
              company.careersUrl ? (
                <a href={company.careersUrl} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline">Visit careers page</Button>
                </a>
              ) : undefined
            }
          />
        ) : roles.length === 0 ? (
          <EmptyState title={`No ${season} roles`} description="Try a different term." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {roles.map((r) => (
              <RoleCard key={r.id} role={r} saved={savedIds.has(r.id)} onToggleSave={toggleSave} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SeasonFilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
        (active ? 'bg-cyan text-navy' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-cyan')
      }
    >
      {label}
    </button>
  );
}