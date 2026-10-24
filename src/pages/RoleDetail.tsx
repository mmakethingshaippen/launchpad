import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, Flag, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useAdapter } from '../hooks/useAdapter';
import { useApplications } from '../hooks/useApplications';
import { Button } from '../components/ui/Button';
import { Badge, SeasonBadge } from '../components/ui/Badge';
import { RoleDetailSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { RelativeTime } from '../components/ui/RelativeTime';
import { sanitizeHtml } from '../lib/sanitize';
import { formatLocation } from '../lib/locationFormat';

export function RoleDetail() {
  const { slug = '' } = useParams();
  const adapter = useAdapter();
  const { applications, upsert, remove, isRolePending, canEdit, error, retry } = useApplications();
  const [reported, setReported] = useState(false);

  const { data: role, isLoading } = useQuery({
    queryKey: ['role', slug],
    queryFn: () => adapter.getRole(slug),
  });

  if (isLoading) return <RoleDetailSkeleton />;
  if (!role)
    return (
      <EmptyState
        title="Opportunity not found"
        description="This listing may have been removed."
        action={
          <Link to="/browse">
            <Button variant="outline">Back to Browse</Button>
          </Link>
        }
      />
    );

  const isClosed = role.listingStatus !== 'Active';
  const trackedApplication = applications.find((application) => application.roleId === role.id);
  const isSaving = !canEdit || isRolePending(role.id);
  const cleanDescription = sanitizeHtml(role.description);

  const report = async () => {
    await adapter.reportListing({ roleId: role.id, reason: 'expired' });
    setReported(true);
  };

  const formattedLocation = formatLocation({
    city: role.city,
    state: role.state,
    country: role.country,
    workArrangement: role.workArrangement,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Helmet>
        <title>{`${role.title} at ${role.companyName} — Launchpad`}</title>
        <meta name="description" content={`${role.opportunityType} · ${role.field} · ${role.companyName}`} />
        <meta property="og:title" content={`${role.title} at ${role.companyName}`} />
      </Helmet>

      <Link to="/browse" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Browse
      </Link>

      {isClosed && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">This listing is no longer accepting applications.</p>
            <p className="text-sm">
              Explore{' '}
              <Link to={`/companies/${role.companySlug}`} className="underline">
                other roles at {role.companyName}
              </Link>{' '}
              or{' '}
              <Link to={`/browse?field=${role.field}`} className="underline">
                similar {role.field} roles
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <header className="rounded-xl border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold text-navy">{role.title}</h1>
        <p className="mt-1 text-slate-600">
          <Link to={`/companies/${role.companySlug}`} className="font-medium hover:text-cyan">
            {role.companyName}
          </Link>
          {role.companyType && <span className="text-slate-400"> · {role.companyType}</span>}
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {role.seasons.map((s) => (
            <SeasonBadge key={s} season={s} year={role.cohortYear} />
          ))}
          <Badge tone="cyan">{role.opportunityType}</Badge>
          <Badge tone="muted">{role.workArrangement}</Badge>
          <Badge tone="muted">{role.workSchedule}</Badge>
          {role.degreeLevels.map((d) => (
            <Badge key={d} tone="muted">
              {d}
            </Badge>
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Meta label="Field" value={role.field} />
          <Meta label="Location" value={formattedLocation || '—'} />
          <Meta label="Compensation" value={compLabel(role)} />
          <Meta label="Duration" value={role.duration ?? '—'} />
          <Meta
            label="Application deadline"
            value={role.applicationDeadline ? new Date(role.applicationDeadline).toLocaleDateString() : 'Not specified'}
          />
          <Meta label="Last verified" value={<RelativeTime iso={role.lastVerifiedAt} />} />
        </dl>

        {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}{' '}
          {!canEdit && <button type="button" onClick={retry} className="underline">Retry</button>}
        </p>}
        {!isClosed && (
          <div className="mt-6 flex flex-wrap gap-2">
            <a href={role.applyUrl} target="_blank" rel="noopener noreferrer" onClick={() => { if (!trackedApplication && !isSaving) upsert({ roleId: role.id, companyName: role.companyName, roleTitle: role.title, status: 'Applied', applicationUrl: role.applyUrl }); }}>
              <Button size="lg">
                Apply on Company Website <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </a>
            {trackedApplication ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => remove(trackedApplication.id)}
                aria-pressed={true}
                aria-busy={isSaving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                title="Click to remove from tracked applications"
                aria-label="Tracked. Click to untrack"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                <span>Tracked</span>
              </button>
            ) : (
              <Button
                variant="outline"
                size="lg"
                disabled={isSaving}
                onClick={() => {
                  upsert({
                    roleId: role.id,
                    companyName: role.companyName,
                    roleTitle: role.title,
                    status: 'Applied',
                    applicationUrl: role.applyUrl,
                  });
                }}
              >
                {isSaving ? 'Saving…' : '+ Track Application'}
              </Button>
            )}
            <Button variant="ghost" size="lg" onClick={report} disabled={reported}>
              <Flag className="h-4 w-4" aria-hidden="true" /> {reported ? 'Reported' : 'Report issue'}
            </Button>
          </div>
        )}
      </header>

      {cleanDescription && (
        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-lg font-semibold text-navy">About this role</h2>
          <div className="prose prose-sm max-w-none text-slate-700" dangerouslySetInnerHTML={{ __html: cleanDescription }} />
          {role.sourceUrl && (
            <p className="mt-4 text-xs text-slate-400">
              Source:{' '}
              <a href={role.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                original listing
              </a>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-navy">{value}</dd>
    </div>
  );
}

function compLabel(role: { compensationStatus: string; pay: { min: number | null; max: number | null; currency: string | null; period: string | null } | null }): string {
  if (role.compensationStatus === 'Unpaid') return 'Unpaid';
  if (role.compensationStatus === 'Not disclosed') return 'Not disclosed';
  if (!role.pay || (role.pay.min == null && role.pay.max == null)) return 'Paid';
  const cur = role.pay.currency ?? 'USD';
  const fmt = (n: number) => `${cur === 'USD' ? '$' : cur + ' '}${n.toLocaleString()}`;
  const isRange = role.pay.min != null && role.pay.max != null && role.pay.min !== role.pay.max;
  const range = isRange ? `${fmt(role.pay.min!)}–${fmt(role.pay.max!)}` : fmt((role.pay.min ?? role.pay.max)!);
  return role.pay.period ? `${range}/${role.pay.period}` : range;
}
