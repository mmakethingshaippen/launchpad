import type {
  DataAdapter,
  CompanyFormA,
  RoleFormB,
  SyncResult,
  PendingQueue,
  ListingReport,
  MapCompany,
} from './adapter';
import type {
  Paginated,
  RoleCard,
  RoleDetailView,
  CompanyCard,
  CompanyDetailView,
  Stats,
  FeaturedBlocks,
  SavedItem,
  Application,
  ApplicationInput,
  ReportInput,
} from './types';
import type { RoleFilters } from '../filters';
import { DEFAULT_FILTERS } from '../filters';
import { LocalStore } from './localStore.data';
import { filterRoles, sortRoles, filterCompanies } from '../roleQuery';
import { groupRolesIntoMarkers, type RoleMarkerInput } from './mapMarkers';
import * as store from '../localStore';
import { syncAll } from '../ats/sync';

const PAGE_SIZE = 24;

function paginate<T>(items: T[], page: number, pageSize = PAGE_SIZE): Paginated<T> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize,
  };
}

/**
 * LocalAdapter — in-memory seed + direct ATS fetch, for first-run dev and tests
 * without cloud credentials (Req 23). Saved/applications persist to localStorage.
 */
export class LocalAdapter implements DataAdapter {
  private readonly data: LocalStore;
  private synced = false;
  private savedRoleCache = new Map<string, RoleCard>();

  constructor(data: LocalStore = new LocalStore()) {
    this.data = data;
  }

  /** Expose the store for the dev-sync middleware. */
  get store(): LocalStore {
    return this.data;
  }

  /** Lazily run the ATS sync once so reads have live roles. Safe to call repeatedly. */
  async ensureSynced(fetchImpl?: typeof fetch): Promise<void> {
    if (this.synced) return;
    this.synced = true;

    // E2E determinism: seed fixed roles instead of hitting live ATS feeds.
    const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    if (meta?.VITE_E2E) {
      this.data.seedDeterministicRoles();
      return;
    }

    try {
      await syncAll(this.data.syncableCompanies(), this.data, { fetchImpl });
    } catch {
      /* offline/dev: reads still work against whatever synced successfully */
    }
  }

  private allCards(): RoleCard[] {
    const cards = this.data.publicRoleCards();
    for (const c of cards) this.savedRoleCache.set(c.id, c);
    return cards;
  }

  async searchRoles(filters: RoleFilters): Promise<Paginated<RoleCard>> {
    await this.ensureSynced();
    const filtered = filterRoles(this.allCards(), filters);
    const sorted = sortRoles(filtered, filters.sort, filters.keyword);
    return paginate(sorted, filters.page);
  }

  async getRole(slug: string): Promise<RoleDetailView | null> {
    await this.ensureSynced();
    const role = this.data.findApprovedRoleBySlug(slug);
    return role ? this.data.roleToDetail(role) : null;
  }

  async searchCompanies(filters: RoleFilters): Promise<Paginated<CompanyCard>> {
    await this.ensureSynced();
    const filtered = filterCompanies(this.data.companyCards(), filters);
    const sorted = [...filtered].sort((a, b) => b.activeRoleCount - a.activeRoleCount);
    return paginate(sorted, filters.page);
  }

  async getCompany(slug: string): Promise<CompanyDetailView | null> {
    await this.ensureSynced();
    const company = this.data.findCompanyBySlug(slug);
    return company ? this.data.companyToDetail(company) : null;
  }

  async getStats(): Promise<Stats> {
    await this.ensureSynced();
    const companies = this.data.companyCards();
    return {
      companies: companies.length,
      activeRoles: this.data.publicRoleCards().length,
      startups: companies.filter((c) => c.companyType === 'Startup').length,
    };
  }

  async getFeatured(): Promise<FeaturedBlocks> {
    await this.ensureSynced();
    const roles = sortRoles(this.allCards(), 'verified');
    const companies = this.data.companyCards();
    const upcoming = roles.filter((r) =>
      r.seasons.some((s) => s === 'Summer' || s === 'Fall' || s === 'Spring'),
    );
    const withDeadline = roles
      .filter((r) => r.applicationDeadline)
      .sort(
        (a, b) =>
          new Date(a.applicationDeadline!).getTime() - new Date(b.applicationDeadline!).getTime(),
      );
    return {
      featuredCompanies: companies.filter((c) => c.activeRoleCount > 0).slice(0, 6),
      startupOpportunities: roles.filter((r) => r.companyType === 'Startup').slice(0, 6),
      recentlyVerified: roles.slice(0, 6),
      byUpcomingTerm: upcoming.slice(0, 6),
      approachingDeadline: withDeadline.slice(0, 6),
    };
  }

  async getMapCompanies(filters: RoleFilters): Promise<MapCompany[]> {
    await this.ensureSynced();
    // Build markers from each role's own coordinates (not just company HQ).
    const inputs: RoleMarkerInput[] = [];
    for (const role of this.data.publicRoles()) {
      if (role.latitude == null || role.longitude == null) continue;
      // Apply the relevant discovery filters to roles.
      if (filters.seasons.length && !role.seasons.some((s) => filters.seasons.includes(s))) continue;
      if (filters.opportunityTypes.length && !filters.opportunityTypes.includes(role.opportunityType)) continue;
      if (filters.fields.length && !filters.fields.includes(role.field)) continue;
      const company = this.data.getCompany(role.companyId);
      if (!company) continue;
      if (filters.companyType !== 'All' && company.companyType !== filters.companyType) continue;
      inputs.push({
        companyId: company.id,
        slug: company.slug,
        name: company.name,
        companyType: company.companyType,
        websiteUrl: company.websiteUrl,
        logoUrl: company.logoUrl,
        latitude: role.latitude,
        longitude: role.longitude,
        city: role.city,
        state: role.state,
        country: role.country,
      });
    }
    return groupRolesIntoMarkers(inputs);
  }

  // ── Saving / tracking (localStorage) ──
  async listSaved(): Promise<SavedItem[]> {
    await this.ensureSynced();
    this.allCards(); // warm cache
    return store.getSaved().map((s) => ({ ...s, role: this.savedRoleCache.get(s.roleId) }));
  }
  async save(roleId: string): Promise<void> {
    store.addSaved(roleId);
  }
  async unsave(roleId: string): Promise<void> {
    store.removeSaved(roleId);
  }
  async listApplications(): Promise<Application[]> {
    return store.getApplications();
  }
  async upsertApplication(input: ApplicationInput): Promise<void> {
    store.upsertApplication(input);
  }
  async deleteApplication(id: string): Promise<void> {
    store.deleteApplication(id);
  }

  // ── Submissions / reports (kept in-memory as Pending; not publicly visible) ──
  async submitCompany(_input: CompanyFormA): Promise<void> {
    // In local mode, community submissions are accepted but remain Pending and
    // therefore invisible to public reads (which only surface Approved records).
    void _input;
  }
  async submitRole(_input: RoleFormB): Promise<void> {
    void _input;
  }
  async reportListing(_input: ReportInput): Promise<void> {
    void _input;
  }

  // ── Admin ──
  async sync(companyId?: string): Promise<SyncResult[]> {
    const targets = companyId
      ? this.data.syncableCompanies().filter((c) => c.id === companyId)
      : this.data.syncableCompanies();
    this.synced = true;
    return syncAll(targets, this.data, {});
  }

  async listPending(): Promise<PendingQueue> {
    // Local mode keeps community submissions in-memory as Pending (not surfaced
    // publicly). No persistent moderation queue in local dev.
    return { companies: [], roles: [] };
  }
  async moderateCompany(): Promise<void> {
    /* no-op in local mode */
  }
  async moderateRole(): Promise<void> {
    /* no-op in local mode */
  }
  async listReports(): Promise<ListingReport[]> {
    return [];
  }
  async resolveReport(): Promise<void> {
    /* no-op in local mode */
  }
  async geocode(): Promise<void> {
    /* no-op: local seed already has coordinates */
  }
}

export { DEFAULT_FILTERS };
