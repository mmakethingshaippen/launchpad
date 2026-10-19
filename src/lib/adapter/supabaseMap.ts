import type {
  RoleCard,
  RoleDetailView,
  CompanyCard,
  CompanyDetailView,
  CompanyLocation,
  Application,
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RoleRow {
  id: string;
  slug: string;
  company_id: string;
  external_job_id: string | null;
  title: string;
  field: string;
  seasons: string[];
  cohort_year: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  work_arrangement: string;
  degree_levels: string[];
  opportunity_type: string;
  work_schedule: string;
  compensation_status: string;
  pay_min: number | null;
  pay_max: number | null;
  pay_currency: string | null;
  pay_period: string | null;
  duration: string | null;
  application_deadline: string | null;
  apply_url: string;
  description: string | null;
  source: string;
  source_url: string | null;
  listing_status: string;
  last_verified_at: string | null;
  companies?: CompanyRow | CompanyRow[] | null;
}

interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  careers_url: string | null;
  description: string | null;
  fields: string[];
  company_type: string;
  startup_stage: string | null;
  employee_count_range: string | null;
  founding_year: number | null;
  degree_levels: string[];
  last_verified_at: string | null;
  company_locations?: LocationRow[];
}

interface LocationRow {
  id: string;
  company_id: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  location_type: string;
}

function firstCompany(c: RoleRow['companies']): CompanyRow | null {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

export function mapRoleCard(row: RoleRow): RoleCard {
  const c = firstCompany(row.companies);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    companyName: c?.name ?? 'Unknown',
    companySlug: c?.slug ?? '',
    companyLogoUrl: c?.logo_url ?? null,
    companyType: (c?.company_type as RoleCard['companyType']) ?? null,
    seasons: row.seasons as RoleCard['seasons'],
    cohortYear: row.cohort_year,
    field: row.field as RoleCard['field'],
    city: row.city,
    state: row.state,
    country: row.country,
    workArrangement: row.work_arrangement as RoleCard['workArrangement'],
    degreeLevels: row.degree_levels as RoleCard['degreeLevels'],
    opportunityType: row.opportunity_type as RoleCard['opportunityType'],
    compensationStatus: row.compensation_status as RoleCard['compensationStatus'],
    pay:
      row.pay_min != null || row.pay_max != null
        ? { min: row.pay_min, max: row.pay_max, currency: row.pay_currency, period: row.pay_period }
        : null,
    applicationDeadline: row.application_deadline,
    lastVerifiedAt: row.last_verified_at,
    listingStatus: row.listing_status as RoleCard['listingStatus'],
  };
}

export function mapRoleDetail(row: RoleRow): RoleDetailView {
  return {
    ...mapRoleCard(row),
    description: row.description,
    workSchedule: row.work_schedule as RoleDetailView['workSchedule'],
    duration: row.duration,
    applyUrl: row.apply_url,
    source: row.source as RoleDetailView['source'],
    sourceUrl: row.source_url,
  };
}

export function mapLocation(row: LocationRow): CompanyLocation {
  return {
    id: row.id,
    companyId: row.company_id,
    city: row.city,
    state: row.state,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    locationType: row.location_type as CompanyLocation['locationType'],
  };
}

export function mapCompanyCard(row: CompanyRow, activeRoleCount: number): CompanyCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url,
    fields: row.fields as CompanyCard['fields'],
    companyType: row.company_type as CompanyCard['companyType'],
    startupStage: (row.startup_stage as CompanyCard['startupStage']) ?? null,
    employeeCountRange: (row.employee_count_range as CompanyCard['employeeCountRange']) ?? null,
    foundingYear: row.founding_year,
    description: row.description,
    careersUrl: row.careers_url,
    degreeLevels: row.degree_levels as CompanyCard['degreeLevels'],
    locations: (row.company_locations ?? []).map(mapLocation),
    activeRoleCount,
  };
}

export function mapCompanyDetail(
  row: CompanyRow,
  roles: RoleCard[],
): CompanyDetailView {
  return {
    ...mapCompanyCard(row, roles.length),
    websiteUrl: row.website_url,
    lastVerifiedAt: row.last_verified_at,
    roles,
  };
}

export function mapApplication(row: any): Application {
  return {
    id: row.id,
    roleId: row.role_id ?? null,
    companyName: row.company_name,
    roleTitle: row.role_title,
    status: row.status,
    notes: row.notes ?? null,
    applicationUrl: row.application_url ?? null,
    appliedAt: row.applied_at ?? null,
    followUpDate: row.follow_up_date ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
