import { Link } from 'react-router-dom';
import { Bookmark, BookmarkCheck, MapPin, ExternalLink } from 'lucide-react';
import type { RoleCard as RoleCardData } from '../../lib/adapter/types';
import { Card } from '../ui/Card';
import { Badge, SeasonBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CompanyLogo } from '../ui/CompanyLogo';
import { formatRelativeTime } from '../ui/RelativeTime';

function locationLabel(r: RoleCardData): string {
  if (r.workArrangement === 'Remote') return 'Remote';
  const parts = [r.city, r.state].filter(Boolean);
  const base = parts.join(', ') || r.country || 'Location N/A';
  return r.workArrangement === 'Hybrid' ? `${base} · Hybrid` : base;
}

function payLabel(r: RoleCardData): string | null {
  if (r.compensationStatus === 'Unpaid') return 'Unpaid';
  if (r.compensationStatus === 'Not disclosed') return null;
  if (!r.pay || (r.pay.min == null && r.pay.max == null)) return 'Paid';
  const cur = r.pay.currency ?? 'USD';
  const fmt = (n: number) => `${cur === 'USD' ? '$' : cur + ' '}${n.toLocaleString()}`;
  const range =
    r.pay.min != null && r.pay.max != null
      ? `${fmt(r.pay.min)}–${fmt(r.pay.max)}`
      : fmt((r.pay.min ?? r.pay.max)!);
  return r.pay.period ? `${range}/${r.pay.period}` : range;
}

export function RoleCard({
  role,
  saved,
  onToggleSave,
}: {
  role: RoleCardData;
  saved?: boolean;
  onToggleSave?: (id: string) => void;
}) {
  const pay = payLabel(role);
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CompanyLogo
            name={role.companyName}
            logoUrl={role.companyLogoUrl}
            websiteUrl={role.companyWebsiteUrl}
            size={40}
          />
          <div>
            <Link to={`/roles/${role.slug}`} className="font-semibold text-navy hover:text-cyan">
              {role.title}
            </Link>
            <p className="text-sm text-slate-500">
              <Link to={`/companies/${role.companySlug}`} className="hover:text-navy">
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
            className="text-slate-400 hover:text-cyan"
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
      </div>

      <dl className="mt-3 space-y-1 text-sm text-slate-600">
        <div className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <span>{locationLabel(role)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5">
          <span>{role.field}</span>
          <span aria-hidden="true" className="text-slate-300">·</span>
          <span>{role.degreeLevels?.join(', ') || 'Undergraduate'}</span>
          {pay && (
            <>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-medium text-navy">{pay}</span>
            </>
          )}
        </div>
      </dl>

      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-xs text-slate-400">
          Verified live {formatRelativeTime(role.lastVerifiedAt)}
        </span>
        <div className="flex gap-2">
          <Link to={`/roles/${role.slug}`}>
            <Button variant="outline" size="sm">
              Details
            </Button>
          </Link>
        </div>
      </div>
      {role.applicationDeadline && (
        <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
          <ExternalLink className="h-3 w-3" aria-hidden="true" /> Apply by{' '}
          {new Date(role.applicationDeadline).toLocaleDateString()}
        </p>
      )}
    </Card>
  );
}
