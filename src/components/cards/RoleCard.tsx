import { Link } from 'react-router-dom';
import { Check, Bookmark, BookmarkCheck, MapPin, ExternalLink, Loader2 } from 'lucide-react';
import type { ApplicationStatus } from '../../lib/adapter/types';
import type { RoleCard as RoleCardData } from '../../lib/adapter/types';
import { Card } from '../ui/Card';
import { Badge, SeasonBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CompanyLogo } from '../ui/CompanyLogo';
import { formatRelativeTime } from '../ui/RelativeTime';
import { formatLocation } from '../../lib/locationFormat';

function locationLabel(r: RoleCardData): string {
  return formatLocation({
    city: r.city,
    state: r.state,
    country: r.country,
    workArrangement: r.workArrangement,
  });
}

function payLabel(r: RoleCardData): string | null {
  if (r.compensationStatus === 'Unpaid') return 'Unpaid';
  if (r.compensationStatus === 'Not disclosed') return null;
  if (!r.pay || (r.pay.min == null && r.pay.max == null)) return 'Paid';
  const cur = r.pay.currency ?? 'USD';
  const fmt = (n: number) => `${cur === 'USD' ? '$' : cur + ' '}${n.toLocaleString()}`;
  const isRange = r.pay.min != null && r.pay.max != null && r.pay.min !== r.pay.max;
  const range = isRange
    ? `${fmt(r.pay.min!)}–${fmt(r.pay.max!)}`
    : fmt((r.pay.min ?? r.pay.max)!);
  return r.pay.period ? `${range}/${r.pay.period}` : range;
}

export function RoleCard({
  role,
  saved,
  onToggleSave,
  tracked = false,
  trackingSaving = false,
  onTrack,
  onToggleTrack,
}: {
  role: RoleCardData;
  saved?: boolean;
  onToggleSave?: (id: string) => void;
  tracked?: boolean;
  trackingSaving?: boolean;
  onTrack?: (id: string, status: ApplicationStatus) => void;
  onToggleTrack?: (role: RoleCardData) => void;
}) {
  const pay = payLabel(role);
  const handleTrackClick = () => {
    if (onToggleTrack) {
      onToggleTrack(role);
    } else if (onTrack) {
      onTrack(role.id, 'Applied');
    }
  };

  const hasTrackingAction = Boolean(onToggleTrack || onTrack);

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <CompanyLogo
            name={role.companyName}
            logoUrl={role.companyLogoUrl}
            websiteUrl={role.companyWebsiteUrl}
            size={40}
          />
          <div className="min-w-0">
            <Link
              to={`/roles/${role.slug}`}
              className="block truncate font-semibold text-slate-900 hover:text-cyan transition-colors"
            >
              {role.title}
            </Link>
            <p className="truncate text-sm text-slate-500">
              <Link to={`/companies/${role.companySlug}`} className="hover:text-slate-900 transition-colors">
                {role.companyName}
              </Link>
            </p>
          </div>
        </div>
        {onToggleSave && (
          <button
            onClick={() => onToggleSave(role.id)}
            aria-label={saved ? 'Remove from saved' : 'Save opportunity'}
            aria-pressed={saved}
            className="flex-shrink-0 text-slate-400 hover:text-cyan transition-colors"
          >
            {saved ? <BookmarkCheck className="h-5 w-5 text-cyan" /> : <Bookmark className="h-5 w-5" />}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(role.seasons ?? []).map((s) => (
          <SeasonBadge key={s} season={s} year={role.cohortYear} />
        ))}
        <Badge tone="cyan">{role.opportunityType}</Badge>
        {role.field && role.field !== 'Other' && <Badge tone="muted">{role.field}</Badge>}
        {(role.degreeLevels ?? []).map((degree) => (
          <Badge key={degree} tone="muted">
            {degree}
          </Badge>
        ))}
      </div>

      <dl className="mt-3 space-y-1 text-sm text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
          <span className="truncate">{locationLabel(role)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5">
          {pay && <span className="font-medium text-slate-900">{pay}</span>}
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-xs text-slate-400">
          Verified live {formatRelativeTime(role.lastVerifiedAt)}
        </span>
        <div className="flex items-center gap-2">
          {hasTrackingAction &&
            (tracked ? (
              <button
                type="button"
                onClick={handleTrackClick}
                disabled={trackingSaving}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors disabled:opacity-50"
                aria-label={`Tracked ${role.title}. Click to untrack`}
                title="Click to remove from tracked applications"
              >
                {trackingSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{trackingSaving ? 'Updating…' : 'Tracked'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleTrackClick}
                disabled={trackingSaving}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50"
                aria-label={`+ Track ${role.title}`}
                title="Track this opportunity"
              >
                {trackingSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-hidden="true" />
                ) : null}
                <span>{trackingSaving ? 'Saving…' : '+ Track'}</span>
              </button>
            ))}
          <Link to={`/roles/${role.slug}`}>
            <Button variant="outline" size="sm">
              Details
            </Button>
          </Link>
        </div>
      </div>
      {role.applicationDeadline && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <ExternalLink className="h-3 w-3 flex-shrink-0" aria-hidden="true" /> Apply by{' '}
          {new Date(role.applicationDeadline).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}
