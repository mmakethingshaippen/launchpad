import type {
  Company,
  CompanyLocation,
  Role,
  CompanyCard,
  RoleCard,
  CompanyDetailView,
  RoleDetailView,
} from './types';
import { SEED_COMPANIES, type SeedCompany } from '../../data/seed-companies';
import type { SyncSink, UpsertRoleData } from '../ats/sync';
import { roleConcluded } from '../ats/seasons';
import { classifyField } from '../ats/classify';
import { resolveRoleCoords, isRemoteLocation } from '../ats/cityCoords';
import type { WorkArrangement } from './types';

function uid(seed: string): string {
  return `seed-${seed}`;
}

/** Resolve role coordinates: role city first, else company HQ (Remote/unknown). */
function resolveCoords(
  locationString: string,
  workArrangement: WorkArrangement | undefined,
  hq: CompanyLocation | undefined,
): { latitude: number | null; longitude: number | null } {
  const remote = workArrangement === 'Remote' || isRemoteLocation(locationString);
  if (!remote) {
    const hit = resolveRoleCoords(locationString);
    if (hit) return { latitude: hit.latitude, longitude: hit.longitude };
  }
  if (hq?.latitude != null && hq?.longitude != null) {
    return { latitude: hq.latitude, longitude: hq.longitude };
  }
  return { latitude: null, longitude: null };
}

function companyFromSeed(s: SeedCompany): Company {
  const now = new Date().toISOString();
  return {
    id: uid(s.slug),
    slug: s.slug,
    name: s.name,
    logoUrl: s.logoUrl ?? null,
    websiteUrl: s.websiteUrl,
    careersUrl: s.careersUrl,
    description: s.description,
    fields: s.fields,
    companyType: s.companyType,
    startupStage: s.startupStage ?? null,
    employeeCountRange: s.employeeCountRange ?? null,
    foundingYear: s.foundingYear ?? null,
    degreeLevels: s.degreeLevels,
    atsProvider: s.atsProvider,
    atsBoardToken: s.atsBoardToken,
    source: 'seed',
    moderationStatus: 'Approved',
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function locationsFromSeed(s: SeedCompany): CompanyLocation[] {
  return s.locations.map((l, i) => ({
    id: `${uid(s.slug)}-loc-${i}`,
    companyId: uid(s.slug),
    city: l.city,
    state: l.state ?? null,
    country: l.country,
    latitude: l.latitude,
    longitude: l.longitude,
    locationType: l.locationType ?? 'HQ',
  }));
}

/**
 * In-memory data store for LocalAdapter and the dev-sync route. Holds the seed
 * companies/locations and any roles produced by the sync engine; also acts as
 * the SyncSink so sync writes land here.
 */
export class LocalStore implements SyncSink {
  companies = new Map<string, Company>();
  locations = new Map<string, CompanyLocation[]>();
  roles = new Map<string, Role>();

  constructor(seed: SeedCompany[] = SEED_COMPANIES) {
    for (const s of seed) {
      const company = companyFromSeed(s);
      this.companies.set(company.id, company);
      this.locations.set(company.id, locationsFromSeed(s));
    }
  }

  // ── SyncSink ───────────────────────────────────────────────────────────────
  async upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'> {
    const existing = [...this.roles.values()].find(
      (r) => r.companyId === data.companyId && r.externalJobId === data.externalJobId,
    );
    const now = new Date().toISOString();

    // Resolve field + coordinates (same logic the Supabase sink uses).
    const company = this.companies.get(data.companyId);
    const field =
      data.field !== 'Other' ? data.field : classifyField(data.title, company?.fields[0], data.employmentTypeRaw);
    const locationString = [data.city, data.state, data.country].filter(Boolean).join(', ');
    const hq = this.locations.get(data.companyId)?.find((l) => l.latitude != null);
    const { latitude, longitude } = resolveCoords(locationString, data.workArrangement, hq);

    if (existing) {
      Object.assign(existing, {
        title: data.title,
        field,
        opportunityType: data.opportunityType,
        degreeLevels: data.degreeLevels,
        seasons: data.seasons,
        cohortYear: data.cohortYear,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? null,
        latitude,
        longitude,
        workArrangement: data.workArrangement ?? existing.workArrangement,
        applyUrl: data.applyUrl,
        description: data.descriptionHtml,
        payMin: data.pay?.min ?? null,
        payMax: data.pay?.max ?? null,
        payCurrency: data.pay?.currency ?? null,
        payPeriod: data.pay?.period ?? null,
        compensationStatus: data.pay ? 'Paid' : existing.compensationStatus,
        listingStatus: 'Active',
        lastVerifiedAt: now,
        updatedAt: now,
      });
      return 'updated';
    }
    const id = `role-${data.companyId}-${data.externalJobId}`;
    this.roles.set(id, {
      id,
      slug: `${id}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      companyId: data.companyId,
      externalJobId: data.externalJobId,
      title: data.title,
      field,
      seasons: data.seasons,
      cohortYear: data.cohortYear,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? null,
      latitude,
      longitude,
      workArrangement: data.workArrangement ?? 'Onsite',
      degreeLevels: data.degreeLevels.length ? data.degreeLevels : (company?.degreeLevels ?? []),
      opportunityType: data.opportunityType,
      workSchedule: 'Full-time',
      compensationStatus: data.pay ? 'Paid' : 'Not disclosed',
      payMin: data.pay?.min ?? null,
      payMax: data.pay?.max ?? null,
      payCurrency: data.pay?.currency ?? null,
      payPeriod: data.pay?.period ?? null,
      duration: null,
      applicationDeadline: null,
      applyUrl: data.applyUrl,
      description: data.descriptionHtml,
      source: 'ats',
      sourceUrl: data.applyUrl,
      moderationStatus: 'Approved',
      listingStatus: 'Active',
      lastVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return 'imported';
  }

  async closeMissing(companyId: string, liveIds: string[]): Promise<number> {
    let closed = 0;
    for (const r of this.roles.values()) {
      if (r.companyId !== companyId || r.source !== 'ats') continue;
      if (r.listingStatus !== 'Active') continue;
      if (r.externalJobId && !liveIds.includes(r.externalJobId)) {
        r.listingStatus = 'Closed';
        r.updatedAt = new Date().toISOString();
        closed++;
      }
    }
    return closed;
  }

  // ── Projections to view DTOs ────────────────────────────────────────────────
  private isPubliclyEligible(r: Role, now = new Date()): boolean {
    const c = this.companies.get(r.companyId);
    if (!c || c.moderationStatus !== 'Approved') return false;
    if (r.moderationStatus !== 'Approved') return false;
    if (r.listingStatus !== 'Active') return false;
    if (r.applicationDeadline && new Date(r.applicationDeadline) < new Date(now.toDateString()))
      return false;
    if (roleConcluded(r.seasons, r.cohortYear, now)) return false;
    return true;
  }

  roleToCard(r: Role): RoleCard {
    const c = this.companies.get(r.companyId);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      companyName: c?.name ?? 'Unknown',
      companySlug: c?.slug ?? '',
      companyLogoUrl: c?.logoUrl ?? null,
      companyWebsiteUrl: c?.websiteUrl ?? null,
      companyType: c?.companyType ?? null,
      seasons: r.seasons,
      cohortYear: r.cohortYear,
      field: r.field,
      city: r.city,
      state: r.state,
      country: r.country,
      workArrangement: r.workArrangement,
      degreeLevels: r.degreeLevels,
      opportunityType: r.opportunityType,
      compensationStatus: r.compensationStatus,
      pay:
        r.payMin != null || r.payMax != null
          ? { min: r.payMin, max: r.payMax, currency: r.payCurrency, period: r.payPeriod }
          : null,
      applicationDeadline: r.applicationDeadline,
      lastVerifiedAt: r.lastVerifiedAt,
      listingStatus: r.listingStatus,
    };
  }

  roleToDetail(r: Role): RoleDetailView {
    return {
      ...this.roleToCard(r),
      description: r.description,
      workSchedule: r.workSchedule,
      duration: r.duration,
      applyUrl: r.applyUrl,
      source: r.source,
      sourceUrl: r.sourceUrl,
    };
  }

  companyToCard(c: Company): CompanyCard {
    const activeRoleCount = [...this.roles.values()].filter(
      (r) => r.companyId === c.id && this.isPubliclyEligible(r),
    ).length;
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      logoUrl: c.logoUrl,
      websiteUrl: c.websiteUrl,
      fields: c.fields,
      companyType: c.companyType,
      startupStage: c.startupStage,
      employeeCountRange: c.employeeCountRange,
      foundingYear: c.foundingYear,
      description: c.description,
      careersUrl: c.careersUrl,
      degreeLevels: c.degreeLevels,
      locations: this.locations.get(c.id) ?? [],
      activeRoleCount,
    };
  }

  companyToDetail(c: Company): CompanyDetailView {
    const roles = [...this.roles.values()]
      .filter((r) => r.companyId === c.id && this.isPubliclyEligible(r))
      .map((r) => this.roleToCard(r));
    return {
      ...this.companyToCard(c),
      websiteUrl: c.websiteUrl,
      lastVerifiedAt: c.lastVerifiedAt,
      roles,
    };
  }

  // ── Query surfaces ───────────────────────────────────────────────────────────
  publicRoleCards(): RoleCard[] {
    return [...this.roles.values()]
      .filter((r) => this.isPubliclyEligible(r))
      .map((r) => this.roleToCard(r));
  }

  /** Raw eligible Role records (with coordinates) for building map markers. */
  publicRoles(): Role[] {
    return [...this.roles.values()].filter((r) => this.isPubliclyEligible(r));
  }

  getCompany(id: string): Company | undefined {
    return this.companies.get(id);
  }

  /** Includes closed/expired approved roles (base-table semantics, refinement #1). */
  findApprovedRoleBySlug(slug: string): Role | null {
    for (const r of this.roles.values()) {
      const c = this.companies.get(r.companyId);
      if (r.slug === slug && r.moderationStatus === 'Approved' && c?.moderationStatus === 'Approved')
        return r;
    }
    return null;
  }

  companyCards(): CompanyCard[] {
    return [...this.companies.values()]
      .filter((c) => c.moderationStatus === 'Approved')
      .map((c) => this.companyToCard(c));
  }

  findCompanyBySlug(slug: string): Company | null {
    for (const c of this.companies.values()) {
      if (c.slug === slug && c.moderationStatus === 'Approved') return c;
    }
    return null;
  }

  syncableCompanies() {
    return [...this.companies.values()].map((c) => ({
      id: c.id,
      name: c.name,
      atsProvider: c.atsProvider,
      atsBoardToken: c.atsBoardToken,
    }));
  }

  /**
   * Seed a handful of deterministic roles without any network (used for E2E so
   * the suite does not depend on live ATS feeds). Idempotent.
   */
  seedDeterministicRoles(): void {
    const companies = [...this.companies.values()];
    if (companies.length === 0) return;
    const now = new Date().toISOString();
    const samples: Array<{ title: string; seasons: Role['seasons']; remote: boolean }> = [
      { title: 'Software Engineering Intern - Summer 2027', seasons: ['Summer'], remote: false },
      { title: 'Fall 2027 Data Co-op', seasons: ['Fall'], remote: true },
      { title: 'New Grad Software Engineer', seasons: ['Year-Round'], remote: false },
    ];
    samples.forEach((s, i) => {
      const company = companies[i % companies.length];
      const id = `e2e-${i}`;
      if (this.roles.has(id)) return;
      this.roles.set(id, {
        id,
        slug: `e2e-role-${i}`,
        companyId: company.id,
        externalJobId: `e2e-${i}`,
        title: s.title,
        field: company.fields[0] ?? 'Technology',
        seasons: s.seasons,
        cohortYear: 2027,
        city: s.remote ? null : 'San Francisco',
        state: s.remote ? null : 'CA',
        country: 'USA',
        latitude: s.remote ? null : 37.7749,
        longitude: s.remote ? null : -122.4194,
        workArrangement: s.remote ? 'Remote' : 'Onsite',
        degreeLevels: company.degreeLevels,
        opportunityType: /co-?op/i.test(s.title)
          ? 'Co-op'
          : /new ?grad/i.test(s.title)
            ? 'Entry-level / New-grad'
            : 'Internship',
        workSchedule: 'Full-time',
        compensationStatus: 'Paid',
        payMin: 30,
        payMax: 45,
        payCurrency: 'USD',
        payPeriod: 'hour',
        duration: '12 weeks',
        applicationDeadline: null,
        applyUrl: `https://example.com/apply/${i}`,
        description: '<p>A great early-career opportunity.</p>',
        source: 'ats',
        sourceUrl: `https://example.com/apply/${i}`,
        moderationStatus: 'Approved',
        listingStatus: 'Active',
        lastVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
}
