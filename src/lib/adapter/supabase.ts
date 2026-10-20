import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DataAdapter,
  CompanyFormA,
  RoleFormB,
  SyncResult,
  PendingQueue,
  ListingReport,
  MapMarker,
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
import { getSupabaseClient } from '../supabaseClient';
import { buildRolePlan, PAGE_SIZE } from './supabaseQuery';
import { buildMapMarkers, type MapRoleInput } from './mapMarkers';
import {
  mapRoleCard,
  mapRoleDetail,
  mapCompanyCard,
  mapCompanyDetail,
  mapApplication,
} from './supabaseMap';

const COMPANY_SELECT =
  'id,slug,name,logo_url,website_url,careers_url,description,fields,company_type,startup_stage,employee_count_range,founding_year,degree_levels,last_verified_at,company_locations(*)';
const ROLE_SELECT_WITH_COMPANY = `*, companies!inner(${COMPANY_SELECT})`;

/**
 * SupabaseAdapter — cloud reads/writes. Discovery reads go through the
 * `public_roles` view so the eligibility rule is enforced in the database
 * (Req 16). Writes rely on RLS for authorization.
 */
export class SupabaseAdapter implements DataAdapter {
  private readonly db: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseClient()) {
    this.db = client;
  }

  private async userId(): Promise<string | null> {
    const { data } = await this.db.auth.getUser();
    return data.user?.id ?? null;
  }

  async searchRoles(filters: RoleFilters): Promise<Paginated<RoleCard>> {
    const plan = buildRolePlan(filters);
    let q = this.db.from('public_roles').select(ROLE_SELECT_WITH_COMPANY, { count: 'exact' });

    for (const op of plan.filters) {
      if (op.type === 'eq') q = q.eq(op.column, op.value);
      else if (op.type === 'overlaps') q = q.overlaps(op.column, op.values);
      else if (op.type === 'in') q = q.in(op.column, op.values);
      else if (op.type === 'ilike') q = q.ilike(op.column, op.value);
    }
    if (plan.textSearch) q = q.textSearch('search_tsv', plan.textSearch, { type: 'websearch' });
    if (filters.companyType !== 'All')
      q = q.eq('companies.company_type', filters.companyType);

    q = q.order(plan.order.column, {
      ascending: plan.order.ascending,
      nullsFirst: plan.order.nullsFirst,
    });
    q = q.range(plan.range.from, plan.range.to);

    const { data, count, error } = await q;
    if (error) throw error;
    return {
      items: (data ?? []).map((r) => mapRoleCard(r as never)),
      total: count ?? 0,
      page: filters.page,
      pageSize: plan.range.to - plan.range.from + 1,
    };
  }

  async getRole(slug: string): Promise<RoleDetailView | null> {
    // Read from base `roles` (refinement #1) so closed/expired approved roles
    // still load to render the Closed banner.
    const { data, error } = await this.db
      .from('roles')
      .select(ROLE_SELECT_WITH_COMPANY)
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRoleDetail(data as never) : null;
  }

  async searchCompanies(filters: RoleFilters): Promise<Paginated<CompanyCard>> {
    let q = this.db.from('companies').select(`${COMPANY_SELECT}`, { count: 'exact' }).eq(
      'moderation_status',
      'Approved',
    );
    if (filters.companyType !== 'All') q = q.eq('company_type', filters.companyType);
    if (filters.fields.length) q = q.overlaps('fields', filters.fields);
    if (filters.startupStages.length) q = q.in('startup_stage', filters.startupStages);
    if (filters.employeeRanges.length) q = q.in('employee_count_range', filters.employeeRanges);
    if (filters.keyword) q = q.ilike('name', `%${filters.keyword}%`);

    const from = (filters.page - 1) * PAGE_SIZE;
    q = q.order('name', { ascending: true }).range(from, from + PAGE_SIZE - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    // Active role counts via the eligibility view.
    const rows = (data ?? []) as Array<{ id: string }>;
    const cards = await Promise.all(
      rows.map(async (c) => {
        const { count: rc } = await this.db
          .from('public_roles')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', c.id);
        return mapCompanyCard(c as never, rc ?? 0);
      }),
    );
    return { items: cards, total: count ?? 0, page: filters.page, pageSize: PAGE_SIZE };
  }

  async getCompany(slug: string): Promise<CompanyDetailView | null> {
    const { data, error } = await this.db
      .from('companies')
      .select(COMPANY_SELECT)
      .eq('slug', slug)
      .eq('moderation_status', 'Approved')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: roleRows } = await this.db
      .from('public_roles')
      .select(ROLE_SELECT_WITH_COMPANY)
      .eq('company_id', (data as { id: string }).id);
    const roles = (roleRows ?? []).map((r) => mapRoleCard(r as never));
    return mapCompanyDetail(data as never, roles);
  }

  async getStats(): Promise<Stats> {
    const companies = await this.db
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'Approved');
    const startups = await this.db
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'Approved')
      .eq('company_type', 'Startup');
    const roles = await this.db
      .from('public_roles')
      .select('id', { count: 'exact', head: true });
    return {
      companies: companies.count ?? 0,
      activeRoles: roles.count ?? 0,
      startups: startups.count ?? 0,
    };
  }

  async getFeatured(): Promise<FeaturedBlocks> {
    const recent = await this.db
      .from('public_roles')
      .select(ROLE_SELECT_WITH_COMPANY)
      .order('last_verified_at', { ascending: false })
      .limit(6);
    const recentlyVerified = (recent.data ?? []).map((r) => mapRoleCard(r as never));

    const startupRoles = recentlyVerified.filter((r) => r.companyType === 'Startup');
    const byUpcoming = recentlyVerified.filter((r) =>
      r.seasons.some((s) => s === 'Summer' || s === 'Fall' || s === 'Spring'),
    );
    const deadlineQ = await this.db
      .from('public_roles')
      .select(ROLE_SELECT_WITH_COMPANY)
      .not('application_deadline', 'is', null)
      .order('application_deadline', { ascending: true })
      .limit(6);
    const approachingDeadline = (deadlineQ.data ?? []).map((r) => mapRoleCard(r as never));

    const companiesQ = await this.db
      .from('companies')
      .select(COMPANY_SELECT)
      .eq('moderation_status', 'Approved')
      .limit(6);
    const featuredCompanies = (companiesQ.data ?? []).map((c) => mapCompanyCard(c as never, 0));

    return {
      featuredCompanies,
      startupOpportunities: startupRoles.slice(0, 6),
      recentlyVerified,
      byUpcomingTerm: byUpcoming.slice(0, 6),
      approachingDeadline,
    };
  }

  async getMapMarkers(filters: RoleFilters): Promise<MapMarker[]> {
    // Markers are grouped by each ROLE's own city (parsed from its location
    // string), aggregated across all companies — not one pin per company HQ.
    // Coordinates are resolved in TypeScript so this never touches latitude/
    // longitude columns that may not exist in the live schema.
    let q = this.db
      .from('public_roles')
      .select(
        'id, slug, title, seasons, cohort_year, city, state, country, work_arrangement, company_id, ' +
          'companies!inner(slug,name,company_type,website_url,logo_url,company_locations(city,state,latitude,longitude,location_type))',
      );

    if (filters.seasons.length) q = q.overlaps('seasons', filters.seasons);
    if (filters.opportunityTypes.length) q = q.in('opportunity_type', filters.opportunityTypes);
    if (filters.fields.length) q = q.in('field', filters.fields);
    if (filters.companyType !== 'All') q = q.eq('companies.company_type', filters.companyType);

    const { data, error } = await q;
    if (error) throw error;

    const inputs: MapRoleInput[] = [];
    for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const r = row;
      const compRaw = r.companies as Record<string, unknown> | Record<string, unknown>[] | null;
      const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as Record<string, unknown> | null;
      if (!comp) continue;

      const locs = (comp.company_locations as Array<Record<string, unknown>>) ?? [];
      const hq =
        locs.find((l) => l.location_type === 'HQ' && l.latitude != null) ??
        locs.find((l) => l.latitude != null);

      const locationString = [r.city, r.state, r.country].filter(Boolean).join(', ');
      inputs.push({
        hqCity: (hq?.city as string) ?? null,
        hqState: (hq?.state as string) ?? null,
        id: r.id as string,
        slug: r.slug as string,
        title: r.title as string,
        seasons: (r.seasons as string[]) ?? [],
        cohortYear: (r.cohort_year as number) ?? null,
        locationString,
        workArrangement: (r.work_arrangement as string) ?? null,
        companyId: r.company_id as string,
        companyName: comp.name as string,
        companySlug: comp.slug as string,
        companyWebsiteUrl: (comp.website_url as string) ?? null,
        companyLogoUrl: (comp.logo_url as string) ?? null,
        hqLatitude: (hq?.latitude as number) ?? null,
        hqLongitude: (hq?.longitude as number) ?? null,
      });
    }
    return buildMapMarkers(inputs);
  }

  // ── Saving / tracking ──
  async listSaved(): Promise<SavedItem[]> {
    const uid = await this.userId();
    if (!uid) return [];
    const { data, error } = await this.db
      .from('saved_opportunities')
      .select('role_id, created_at, roles(*, companies!inner(' + COMPANY_SELECT + '))')
      .eq('user_id', uid);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Array<{
      role_id: string;
      created_at: string;
      roles?: unknown;
    }>;
    return rows.map((r) => ({
      roleId: r.role_id,
      savedAt: r.created_at,
      role: r.roles ? mapRoleCard(r.roles as never) : undefined,
    }));
  }

  async save(roleId: string): Promise<void> {
    const uid = await this.userId();
    if (!uid) throw new Error('Not authenticated');
    const { error } = await this.db
      .from('saved_opportunities')
      .upsert({ user_id: uid, role_id: roleId }, { onConflict: 'user_id,role_id' });
    if (error) throw error;
  }

  async unsave(roleId: string): Promise<void> {
    const uid = await this.userId();
    if (!uid) return;
    await this.db.from('saved_opportunities').delete().eq('user_id', uid).eq('role_id', roleId);
  }

  async listApplications(): Promise<Application[]> {
    const uid = await this.userId();
    if (!uid) return [];
    const { data, error } = await this.db
      .from('applications')
      .select('*')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapApplication);
  }

  async upsertApplication(input: ApplicationInput): Promise<void> {
    const uid = await this.userId();
    if (!uid) throw new Error('Not authenticated');
    const row = {
      user_id: uid,
      role_id: input.roleId ?? null,
      company_name: input.companyName,
      role_title: input.roleTitle,
      status: input.status ?? 'Applied',
      notes: input.notes ?? null,
      application_url: input.applicationUrl ?? null,
      applied_at: input.appliedAt ?? null,
      follow_up_date: input.followUpDate ?? null,
    };
    const { error } = await this.db.from('applications').upsert(row, {
      onConflict: input.roleId ? 'user_id,role_id' : undefined,
    });
    if (error) throw error;
  }

  async deleteApplication(id: string): Promise<void> {
    const uid = await this.userId();
    if (!uid) return;
    await this.db.from('applications').delete().eq('id', id).eq('user_id', uid);
  }

  // ── Submissions / reports (forced to Pending by RLS check) ──
  async submitCompany(input: CompanyFormA): Promise<void> {
    const { error } = await this.db.from('companies').insert({
      slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      name: input.name,
      website_url: input.websiteUrl,
      careers_url: input.careersUrl,
      description: input.description,
      fields: input.fields,
      company_type: input.companyType,
      degree_levels: input.degreeLevels,
      ats_provider: input.atsProvider ?? 'none',
      ats_board_token: input.atsBoardToken ?? null,
      source: 'community',
      moderation_status: 'Pending',
    });
    if (error) throw error;
  }

  async submitRole(input: RoleFormB): Promise<void> {
    const { error } = await this.db.from('roles').insert({
      company_id: input.companyId,
      slug: `${input.title}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: input.title,
      field: input.field,
      seasons: input.seasons,
      work_arrangement: input.workArrangement,
      degree_levels: input.degreeLevels,
      opportunity_type: input.opportunityType,
      work_schedule: input.workSchedule,
      compensation_status: input.compensationStatus,
      apply_url: input.applyUrl,
      description: input.description,
      source: 'community',
      source_url: input.sourceUrl ?? null,
      moderation_status: 'Pending',
    });
    if (error) throw error;
  }

  async reportListing(input: ReportInput): Promise<void> {
    const uid = await this.userId();
    const { error } = await this.db.from('listing_reports').insert({
      role_id: input.roleId,
      reason: input.reason,
      details: input.details ?? null,
      reporter_id: uid,
    });
    if (error) throw error;
  }

  // ── Admin ──
  async listPending(): Promise<PendingQueue> {
    const [companies, roles] = await Promise.all([
      this.db
        .from('companies')
        .select('id,name,website_url,careers_url,company_type,source,created_at')
        .eq('moderation_status', 'Pending')
        .order('created_at', { ascending: true }),
      this.db
        .from('roles')
        .select('id,title,field,seasons,apply_url,source,created_at,companies(name)')
        .eq('moderation_status', 'Pending')
        .order('created_at', { ascending: true }),
    ]);
    if (companies.error) throw companies.error;
    if (roles.error) throw roles.error;
    return {
      companies: (companies.data ?? []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        name: c.name as string,
        websiteUrl: (c.website_url as string) ?? null,
        careersUrl: (c.careers_url as string) ?? null,
        companyType: c.company_type as string,
        source: c.source as string,
        createdAt: c.created_at as string,
      })),
      roles: (roles.data ?? []).map((r: Record<string, unknown>) => {
        const comp = r.companies as { name?: string } | { name?: string }[] | null;
        const companyName = Array.isArray(comp) ? comp[0]?.name : comp?.name;
        return {
          id: r.id as string,
          title: r.title as string,
          companyName: companyName ?? 'Unknown',
          field: r.field as string,
          seasons: (r.seasons as string[]) ?? [],
          applyUrl: r.apply_url as string,
          source: r.source as string,
          createdAt: r.created_at as string,
        };
      }),
    };
  }

  private async recordModeration(entityType: 'company' | 'role', entityId: string, action: string) {
    const uid = await this.userId();
    await this.db.from('moderation_history').insert({
      entity_type: entityType,
      entity_id: entityId,
      action: action.toLowerCase(),
      actor_id: uid,
    });
  }

  async moderateCompany(id: string, action: 'Approved' | 'Rejected'): Promise<void> {
    const { error } = await this.db.from('companies').update({ moderation_status: action }).eq('id', id);
    if (error) throw error;
    await this.recordModeration('company', id, action);
  }

  async moderateRole(id: string, action: 'Approved' | 'Rejected'): Promise<void> {
    const { error } = await this.db.from('roles').update({ moderation_status: action }).eq('id', id);
    if (error) throw error;
    await this.recordModeration('role', id, action);
  }

  async listReports(): Promise<ListingReport[]> {
    const { data, error } = await this.db
      .from('listing_reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string,
      roleId: r.role_id as string,
      reason: r.reason as string,
      details: (r.details as string) ?? null,
      resolved: Boolean(r.resolved),
      createdAt: r.created_at as string,
    }));
  }

  async resolveReport(id: string): Promise<void> {
    const { error } = await this.db.from('listing_reports').update({ resolved: true }).eq('id', id);
    if (error) throw error;
  }

  async geocode(locationId: string): Promise<void> {
    // Resolve + persist coordinates for a company_locations row via Nominatim.
    const { data: loc } = await this.db
      .from('company_locations')
      .select('id,city,state,country')
      .eq('id', locationId)
      .maybeSingle();
    if (!loc) return;
    const { Geocoder, buildLocationQuery } = await import('../geocode');
    const geocoder = new Geocoder();
    const result = await geocoder.geocode(buildLocationQuery(loc as never));
    if (result) {
      await this.db
        .from('company_locations')
        .update({ latitude: result.latitude, longitude: result.longitude })
        .eq('id', locationId);
    }
  }

  async sync(companyId?: string): Promise<SyncResult[]> {
    // Production sync runs server-side (api/sync.ts), which authorizes the
    // caller by verifying their Supabase access token and admin role. Attach
    // the active session's access token so the function can identify the user.
    const { data: sessionData } = await this.db.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('You must be signed in as an admin to run a sync.');
    }

    const res = await fetch(`/api/sync${companyId ? `?id=${encodeURIComponent(companyId)}` : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      let message = `Sync failed: HTTP ${res.status}`;
      if (res.status === 401) message = 'Sync failed: your session is not authenticated. Please sign in again.';
      else if (res.status === 403) message = 'Sync failed: your account is not an admin.';
      else {
        // Surface the server error message when available (no secrets are returned).
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = `Sync failed: ${body.error}`;
        } catch {
          /* non-JSON error body */
        }
      }
      throw new Error(message);
    }
    return (await res.json()) as SyncResult[];
  }
}
