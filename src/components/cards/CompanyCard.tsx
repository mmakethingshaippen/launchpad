import { Link } from 'react-router-dom';
import { ExternalLink, MapPin, Plus } from 'lucide-react';
import type { CompanyCard as CompanyCardData } from '../../lib/adapter/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { CompanyLogo } from '../ui/CompanyLogo';

export function CompanyCard({ company }: { company: CompanyCardData }) {
  const loc = company.locations[0];
  const locLabel = loc ? [loc.city, loc.state, loc.country].filter(Boolean).join(', ') : null;
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start gap-3">
        <CompanyLogo name={company.name} logoUrl={company.logoUrl} websiteUrl={company.websiteUrl} size={44} />
        <div className="min-w-0">
          <Link to={`/companies/${company.slug}`} className="font-semibold text-navy hover:text-cyan">
            {company.name}
          </Link>
          <p className="truncate text-sm text-slate-500">{company.fields.join(' · ')}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={company.companyType === 'Startup' ? 'cyan' : 'muted'}>{company.companyType}</Badge>
        {company.startupStage && company.startupStage !== 'Unknown / Not disclosed' && (
          <Badge tone="muted">{company.startupStage}</Badge>
        )}
        {company.employeeCountRange && <Badge tone="muted">{company.employeeCountRange} employees</Badge>}
      </div>

      {company.description && (
        <p className="mt-3 line-clamp-2 text-sm text-slate-600">{company.description}</p>
      )}

      {locLabel && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-500">
          <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
          {locLabel}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="text-sm font-medium text-navy">
          {company.activeRoleCount} active {company.activeRoleCount === 1 ? 'role' : 'roles'}
        </span>
        <div className="flex items-center gap-3 text-sm">
          {company.careersUrl && (
            <a
              href={company.careersUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-500 hover:text-navy"
            >
              Careers <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}
          <Link
            to={`/submit?company=${company.slug}`}
            className="inline-flex items-center gap-1 text-cyan hover:text-navy"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add a Role
          </Link>
        </div>
      </div>
    </Card>
  );
}
