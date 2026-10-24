import { dedupeRoles } from '../roleDeduplication';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DataAdapter,
  SyncBatchOptions,
  SyncBatchResult,
  CompanyFormA,
  RoleFormB,
  SyncResult,
  PendingQueue,
  ListingReport,
  MapMarker,
  MapData,
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
  FieldType,
} from './types';
import type { RoleFilters } from '../filters';
import { DEFAULT_FILTERS } from '../filters';
import { getSupabaseClient } from '../supabaseClient';
import { interleaveByCompany } from '../roleQuery';
import { buildRolePlan, PAGE_SIZE } from './supabaseQuery';
import * as store from '../localStore';
import { buildMapData, type MapRoleInput } from './mapMarkers';
import {
  mapRoleCard as originalMapRoleCard,
  mapRoleDetail as originalMapRoleDetail,
  mapCompanyCard as originalMapCompanyCard,
  mapCompanyDetail as originalMapCompanyDetail,
  mapApplication as originalMapApplication,
} from './supabaseMap';

const COMPANY_SELECT =
  'id,slug,name,logo_url,website_url,careers_url,description,fields,company_type,startup_stage,employee_count_range,founding_year,degree_levels,last_verified_at,company_locations(*)';
const ROLE_SELECT_WITH_COMPANY = `*, companies!inner(${COMPANY_SELECT})`;

// Slimmer select for RoleCards (excludes heavy description text on Browse/Home lists)
const ROLE_CARD_COLUMNS =
  'id,slug,title,company_id,field,seasons,cohort_year,work_arrangement,opportunity_type,work_schedule,compensation_status,city,state,country,apply_url,source_url,application_deadline,last_verified_at,created_at,moderation_status,listing_status,degree_levels,pay_min,pay_max,pay_currency,pay_period';
const ROLE_CARD_SELECT_WITH_COMPANY = `${ROLE_CARD_COLUMNS}, companies!inner(${COMPANY_SELECT})`;

/**
 * Security helper: Enforce strictly http:// or https:// protocols on external URLs
 * to prevent XSS (e.g., javascript: or data: URIs) from scraped feeds or community submissions.
 */
export function sanitizeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol =
    /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Runtime safety sanitizer to guarantee no major tech/engineering company
 * falls back to "Other" or has an empty field array.
 */
function sanitizeFields(fields: FieldType[] | undefined, companyName: string): FieldType[] {
  const valid = (fields || []).filter((f): f is FieldType => Boolean(f) && f !== 'Other');
  if (valid.length > 0) return valid;

  const n = (companyName || '').toLowerCase();
  if (
    /\b(software|tech|ai|data|cloud|salesforce|nvidia|palantir|intel|amd|google|meta|apple|microsoft|amazon|mercor)\b/.test(
      n,
    )
  ) {
    return ['Technology'];
  }
  if (
    /\b(hardware|firmware|mechanical|electrical|energy|power|aerospace|manufacturing|epri|electric power research institute)\b/.test(
      n,
    )
  ) {
    return ['Engineering'];
  }
  if (/\b(health|medical|biotech|pharma|clinical)\b/.test(n)) {
    return ['Healthcare'];
  }
  if (/\b(finance|trading|bank|capital|venture)\b/.test(n)) {
    return ['Finance'];
  }
  return ['Technology'];
}

function sanitizeSingleField(field: FieldType | undefined, companyName: string): FieldType {
  const sanitizedArray = sanitizeFields(field ? [field] : [], companyName);
  return sanitizedArray[0] ?? 'Technology';
}

// Wrapped mappers that automatically sanitize company fields and external URLs on every read
function mapRoleCard(r: any): RoleCard {
  const card = originalMapRoleCard(r);
  if (card) {
    if (card.companyName) {
      card.field = sanitizeSingleField(card.field, card.companyName);
    }
    if ('companyLogoUrl' in card && card.companyLogoUrl) {
      card.companyLogoUrl = sanitizeExternalUrl(card.companyLogoUrl);
    }
    if ('companyWebsiteUrl' in card && card.companyWebsiteUrl) {
      card.companyWebsiteUrl = sanitizeExternalUrl(card.companyWebsiteUrl);
    }
  }
  return card;
}

function mapRoleDetail(r: any): RoleDetailView {
  const detail = originalMapRoleDetail(r);
  if (detail) {
    if (detail.companyName) {
      detail.field = sanitizeSingleField(detail.field, detail.companyName);
    }
    if ('applyUrl' in detail) {
      detail.applyUrl = sanitizeExternalUrl(detail.applyUrl) ?? '#';
    }
    if ('sourceUrl' in detail && detail.sourceUrl) {
      detail.sourceUrl = sanitizeExternalUrl(detail.sourceUrl);
    }
    if ('companyLogoUrl' in detail && detail.companyLogoUrl) {
      detail.companyLogoUrl = sanitizeExternalUrl(detail.companyLogoUrl);
    }
    if ('companyWebsiteUrl' in detail && detail.companyWebsiteUrl) {
      detail.companyWebsiteUrl = sanitizeExternalUrl(detail.companyWebsiteUrl);
    }
  }
  return detail;
}

function mapCompanyCard(c: any, activeRoleCount: number): CompanyCard {
  const card = originalMapCompanyCard(c, activeRoleCount);
  if (card) {
    if (card.name) {
      card.fields = sanitizeFields(card.fields, card.name);
    }
    if ('logoUrl' in card && card.logoUrl) {
      card.logoUrl = sanitizeExternalUrl(card.logoUrl);
    }
    if ('websiteUrl' in card && card.websiteUrl) {
      card.websiteUrl = sanitizeExternalUrl(card.websiteUrl);
    }
  }
  return card;
}

function mapCompanyDetail(c: any, roles: RoleCard[]): CompanyDetailView {
  const detail = originalMapCompanyDetail(c, roles);
  if (detail) {
    if (detail.name) {
      detail.fields = sanitizeFields(detail.fields, detail.name);
    }
    if ('logoUrl' in detail && detail.logoUrl) {
      detail.logoUrl = sanitizeExternalUrl(detail.logoUrl);
    }
    if ('websiteUrl' in detail && detail.websiteUrl) {
      detail.websiteUrl = sanitizeExternalUrl(detail.websiteUrl);
    }
    if ('careersUrl' in detail && detail.careersUrl) {
      detail.careersUrl = sanitizeExternalUrl(detail.careersUrl);
    }
  }
  return detail;
}

function mapApplication(a: any): Application {
  const app = originalMapApplication(a);
  if (app && 'applicationUrl' in app && app.applicationUrl) {
    app.applicationUrl = sanitizeExternalUrl(app.applicationUrl);
  }
  return app;
}

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
    const pageSize = plan.range.to - plan.range.from + 1;

    let companyMatchId: string | null = null;
    if (filters.keyword?.trim()) {
      const kw = filters.keyword.trim();
      const { data: matched } = await this.db
        .from('companies')
        .select('id')
        .or(`name.ilike.${kw},slug.eq.${kw.toLowerCase()}`)
        .limit(1);
      if (matched && matched.length > 0) {
        companyMatchId = (matched[0] as { id: string }).id;
      }
    }

    const build = () => {
      let q = this.db
        .from('public_roles')
        .select(ROLE_CARD_SELECT_WITH_COMPANY, { count: 'exact' });
      for (const op of plan.filters) {
        if (op.type === 'eq') q = q.eq(op.column, op.value);
        else if (op.type === 'overlaps') q = q.overlaps(op.column, op.values);
        else if (op.type === 'in') q = q.in(op.column, op.values);
        else if (op.type === 'ilike') q = q.ilike(op.column, op.value);
      }
      if (companyMatchId) {
        q = q.eq('company_id', companyMatchId);
      } else if (plan.textSearch) {
        q = q.textSearch('search_tsv', plan.textSearch, { type: 'websearch' });
      }
      if (filters.companyType !== 'All') q = q.eq('companies.company_type', filters.companyType);
      q = q.order(plan.order.column, {
        ascending: plan.order.ascending,
        nullsFirst: plan.order.nullsFirst,
      });
      q = q.order('id', { ascending: true });
      return q;
    };

    if (filters.sort === 'verified') {
      const WINDOW = pageSize * 30;
      const windowStart = Math.floor(plan.range.from / WINDOW) * WINDOW;
      const { data, count, error } = await build().range(windowStart, windowStart + WINDOW - 1);
      if (error) throw error;
      const all = (data ?? []).map((r) => mapRoleCard(r as never));
      const deduped = dedupeRoles(all);
      const diversified = interleaveByCompany(deduped);
      const start = plan.range.from - windowStart;
      return {
        items: diversified.slice(start, start + pageSize),
        total: count ?? 0,
        page: filters.page,
        pageSize,
      };
    }

    const { data, count, error } = await build().range(plan.range.from, plan.range.to);
    if (error) throw error;
    const all = (data ?? []).map((r) => mapRoleCard(r as never));
    return {
      items: dedupeRoles(all),
      total: count ?? 0,
      page: filters.page,
      pageSize,
    };
  }

  async getRole(slug: string): Promise<RoleDetailView | null> {
    const { data, error } = await this.db
      .from('roles')
      .select(ROLE_SELECT_WITH_COMPANY)
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRoleDetail(data as never) : null;
  }

  async searchCompanies(filters: RoleFilters): Promise<Paginated<CompanyCard>> {
    const activeCountByCompany = await this.activeRoleCountsByCompany();
    const eligibleIds = [...activeCountByCompany.keys()];
    if (eligibleIds.length === 0) {
      return { items: [], total: 0, page: filters.page, pageSize: PAGE_SIZE };
    }

    let q = this.db
      .from('companies')
      .select(`${COMPANY_SELECT}`, { count: 'exact' })
      .eq('moderation_status', 'Approved')
      .in('id', eligibleIds);
    if (filters.companyType !== 'All') q = q.eq('company_type', filters.companyType);
    if (filters.fields.length) q = q.overlaps('fields', filters.fields);
    if (filters.employeeRanges.length) q = q.in('employee_count_range', filters.employeeRanges);
    if (filters.keyword) q = q.ilike('name', `%${filters.keyword}%`);

    const from = (filters.page - 1) * PAGE_SIZE;
    q = q.order('name', { ascending: true }).range(from, from + PAGE_SIZE - 1);

    const { data, count, error } = await q;
    if (error) throw error;

    const rows = (data ?? []) as Array<{ id: string }>;
    const cards = rows.map((c) => mapCompanyCard(c as never, activeCountByCompany.get(c.id) ?? 0));
    return { items: cards, total: count ?? 0, page: filters.page, pageSize: PAGE_SIZE };
  }

  private async activeRoleCountsByCompany(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.db
        .from('public_roles')
        .select('company_id')
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = (data ?? []) as Array<{ company_id: string }>;
      for (const r of batch) counts.set(r.company_id, (counts.get(r.company_id) ?? 0) + 1);
      if (batch.length < pageSize) break;
    }
    return counts;
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
      .select(ROLE_CARD_SELECT_WITH_COMPANY)
      .eq('company_id', (data as { id: string }).id);
    const rawRoles = (roleRows ?? []).map((r) => mapRoleCard(r as never));
    const roles = dedupeRoles(rawRoles);
    return mapCompanyDetail(data as never, roles);
  }

  async getStats(): Promise<Stats> {
    const roles = await this.db
      .from('public_roles')
      .select('id', { count: 'exact', head: true });

    const activeCountByCompany = await this.activeRoleCountsByCompany();
    const markers = await this.getMapMarkers(DEFAULT_FILTERS);
    const cities = new Set(markers.map((m) => m.id)).size;

    return {
      companies: activeCountByCompany.size,
      activeRoles: roles.count ?? 0,
      startups: 0,
      cities,
    };
  }

  async getFeatured(): Promise<FeaturedBlocks> {
    const recent = await this.db
      .from('public_roles')
      .select(ROLE_CARD_SELECT_WITH_COMPANY)
      .order('last_verified_at', { ascending: false })
      .limit(12);
    const recentlyVerified = (recent.data ?? []).map((r) => mapRoleCard(r as never));
    const recentIds = new Set(recentlyVerified.map((r) => r.id));

    // Upcoming term opportunities pull from distinct query logic:
    // Filter for upcoming terms, ordered by cohort_year DESC, created_at DESC, excluding recentIds
    const upcomingQuery = await this.db
      .from('public_roles')
      .select(ROLE_CARD_SELECT_WITH_COMPANY)
      .overlaps('seasons', ['Summer', 'Fall', 'Spring', 'Winter'])
      .order('cohort_year', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(12);
    const byUpcoming = (upcomingQuery.data ?? [])
      .map((r) => mapRoleCard(r as never))
      .filter((r) => !recentIds.has(r.id));

    const startupRoles = recentlyVerified.filter((r) => r.companyType === 'Startup');
    const deadlineQ = await this.db
      .from('public_roles')
      .select(ROLE_CARD_SELECT_WITH_COMPANY)
      .not('application_deadline', 'is', null)
      .order('application_deadline', { ascending: true })
      .limit(6);
    const approachingDeadline = (deadlineQ.data ?? []).map((r) => mapRoleCard(r as never));

    const activeCountByCompany = await this.activeRoleCountsByCompany();
    const eligibleIds = [...activeCountByCompany.keys()].slice(0, 200);
    const companiesQ = eligibleIds.length
      ? await this.db
          .from('companies')
          .select(COMPANY_SELECT)
          .eq('moderation_status', 'Approved')
          .in('id', eligibleIds)
          .limit(6)
      : { data: [] as unknown[] };
    const featuredCompanies = (companiesQ.data ?? []).map((c) =>
      mapCompanyCard(c as never, activeCountByCompany.get((c as { id: string }).id) ?? 0),
    );

    return {
      featuredCompanies,
      startupOpportunities: startupRoles.slice(0, 6),
      recentlyVerified,
      byUpcomingTerm: byUpcoming.slice(0, 6),
      approachingDeadline,
    };
  }

  async getMapMarkers(filters: RoleFilters): Promise<MapMarker[]> {
    return (await this.getMapData(filters)).markers;
  }

  async getMapData(filters: RoleFilters): Promise<MapData> {
    const PAGE_BATCH = 1000;
    const allRows: Array<Record<string, unknown>> = [];
    const plan = buildRolePlan(filters);
    let afterId: string | null = null;
    let includeCoordinates = false;

    for (;;) {
      let q = this.db
        .from('public_roles')
        .select(
          'id, slug, title, seasons, cohort_year, city, state, country, work_arrangement, company_id, ' +
            (includeCoordinates ? 'latitude, longitude, ' : '') +
            'companies!inner(slug,name,company_type,website_url,logo_url,company_locations(city,state,latitude,longitude,location_type))',
        )
        .order('id', { ascending: true })
        .limit(PAGE_BATCH);

      if (afterId) q = q.gt('id', afterId);
      for (const op of plan.filters) {
        if (op.type === 'eq') q = q.eq(op.column, op.value);
        else if (op.type === 'overlaps') q = q.overlaps(op.column, op.values);
        else if (op.type === 'in') q = q.in(op.column, op.values);
        else if (op.type === 'ilike') q = q.ilike(op.column, op.value);
      }
      if (plan.textSearch) q = q.textSearch('search_tsv', plan.textSearch, { type: 'websearch' });
      if (filters.companyType !== 'All') q = q.eq('companies.company_type', filters.companyType);

      const { data, error } = await q;
      // Older public_roles views don't expose columns added later to roles.
      // Resolve their city text without requiring a production migration.
      if (error && includeCoordinates && /latitude|longitude/i.test(error.message) &&
          (error.code === '42703' || error.code === 'PGRST204')) {
        includeCoordinates = false;
        continue;
      }
      if (error) throw error;

      const batch = (data ?? []) as unknown as Array<Record<string, unknown>>;
      if (batch.length === 0) break;
      allRows.push(...batch);
      const nextId = batch[batch.length - 1].id as string;
      if (!nextId || nextId === afterId) throw new Error('Map pagination did not advance. Please retry.');
      afterId = nextId;
    }

    const inputs: MapRoleInput[] = [];
    for (const r of allRows) {
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
        locationCity: (r.city as string) ?? null,
        locationState: (r.state as string) ?? null,
        workArrangement: (r.work_arrangement as string) ?? null,
        companyId: r.company_id as string,
        companyName: comp.name as string,
        companySlug: comp.slug as string,
        companyWebsiteUrl: sanitizeExternalUrl(comp.website_url as string | null),
        companyLogoUrl: sanitizeExternalUrl(comp.logo_url as string | null),
        latitude: (r.latitude as number) ?? null,
        longitude: (r.longitude as number) ?? null,
        hqLatitude: (hq?.latitude as number) ?? null,
        hqLongitude: (hq?.longitude as number) ?? null,
      });
    }
    return buildMapData(inputs);
  }

  async listSaved(expectedUserId?: string | null): Promise<SavedItem[]> {
    const uid = await this.applicationOwner(expectedUserId);
    if (!uid) {
      const items = store.getSaved();
      if (items.length === 0) return [];
      try {
        const roleIds = items.map((i) => i.roleId);
        const { data } = await this.db
          .from('roles')
          .select(ROLE_CARD_SELECT_WITH_COMPANY)
          .in('id', roleIds);
        const map = new Map((data ?? []).map((r) => [r.id, mapRoleCard(r as never)]));
        return items.map((i) => ({ ...i, role: map.get(i.roleId) }));
      } catch {
        return items;
      }
    }
    const { data, error } = await this.db
      .from('saved_opportunities')
      .select('role_id, created_at, roles(' + ROLE_CARD_SELECT_WITH_COMPANY + ')')
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

  async save(roleId: string, expectedUserId?: string | null): Promise<void> {
    const uid = await this.applicationOwner(expectedUserId);
    if (!uid) {
      store.addSaved(roleId);
      return;
    }
    const { error } = await this.db
      .from('saved_opportunities')
      .upsert({ user_id: uid, role_id: roleId }, { onConflict: 'user_id,role_id' });
    if (error) throw error;
  }

  async unsave(roleId: string): Promise<void> {
    const uid = await this.userId();
    if (!uid) {
      store.removeSaved(roleId);
      return;
    }
    await this.db.from('saved_opportunities').delete().eq('user_id', uid).eq('role_id', roleId);
    store.removeSaved(roleId);
  }

  private async applicationOwner(expectedUserId?: string | null): Promise<string | null> {
    // Explicit guest operations never borrow a newly signed-in session.
    if (expectedUserId === null) return null;
    const { data, error } = await this.db.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') throw error;
    const uid = data.user?.id ?? null;
    if (expectedUserId !== undefined && uid !== expectedUserId) {
      throw new Error('Your session changed. Please sign in again before updating applications.');
    }
    return uid;
  }

  async listApplications(expectedUserId?: string | null): Promise<Application[]> {
    const uid = await this.applicationOwner(expectedUserId);
    if (!uid) {
      return store.getApplications();
    }
    const { data, error } = await this.db
      .from('tracked_applications')
      .select('*')
      .eq('user_id', uid)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapApplication);
  }

  async upsertApplication(input: ApplicationInput, expectedUserId?: string | null): Promise<Application> {
    const uid = await this.applicationOwner(expectedUserId);
    if (!uid) {
      return store.upsertApplication(input);
    }
    const row = {
      user_id: uid,
      role_id: input.roleId ?? null,
      company_name: input.companyName.trim(),
      role_title: input.roleTitle.trim(),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.applicationUrl !== undefined ? { application_url: sanitizeExternalUrl(input.applicationUrl) } : {}),
      ...(input.appliedAt !== undefined ? { applied_at: input.appliedAt } : {}),
      ...(input.followUpDate !== undefined ? { follow_up_date: input.followUpDate } : {}),
    };
    const table = this.db.from('tracked_applications');
    const request = input.id
      ? table.update(row).eq('id', input.id).eq('user_id', uid)
      : table.upsert(row, { onConflict: input.roleId ? 'user_id,role_id' : undefined });
    const { data, error } = await request.select('*').single();
    if (error) throw error;
    if (!data) throw new Error('The application was not saved. Please retry.');
    return mapApplication(data);
  }

  async deleteApplication(id: string, expectedUserId?: string | null): Promise<void> {
    const uid = await this.applicationOwner(expectedUserId);
    if (!uid) {
      store.deleteApplication(id);
      return;
    }
    const { data, error } = await this.db.from('tracked_applications')
      .delete().eq('id', id).eq('user_id', uid).select('id');
    if (error) throw error;
    if (!data?.length) throw new Error('The application could not be removed. Refresh and try again.');
  }

  async submitCompany(input: CompanyFormA): Promise<void> {
    const safeWebsite = sanitizeExternalUrl(input.websiteUrl);
    const safeCareers = sanitizeExternalUrl(input.careersUrl);
    if (!safeWebsite) {
      throw new Error('Please provide a valid HTTPS website URL.');
    }

    const { error } = await this.db.from('companies').insert({
      slug: input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      name: input.name.trim(),
      website_url: safeWebsite,
      careers_url: safeCareers,
      description: input.description.trim(),
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
    const safeApplyUrl = sanitizeExternalUrl(input.applyUrl);
    if (!safeApplyUrl) {
      throw new Error('Please provide a valid HTTPS application URL.');
    }

    const { error } = await this.db.from('roles').insert({
      company_id: input.companyId,
      slug: `${input.title}-${Date.now()}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      title: input.title.trim(),
      field: input.field,
      seasons: input.seasons,
      work_arrangement: input.workArrangement,
      degree_levels: input.degreeLevels,
      opportunity_type: input.opportunityType,
      work_schedule: input.workSchedule,
      compensation_status: input.compensationStatus,
      apply_url: safeApplyUrl,
      description: input.description.trim(),
      source: 'community',
      source_url: sanitizeExternalUrl(input.sourceUrl),
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
        websiteUrl: sanitizeExternalUrl(c.website_url as string | null),
        careersUrl: sanitizeExternalUrl(c.careers_url as string | null),
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
          applyUrl: sanitizeExternalUrl(r.apply_url as string | null) ?? '#',
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
    const { error } = await this.db
      .from('companies')
      .update({ moderation_status: action })
      .eq('id', id);
    if (error) throw error;
    await this.recordModeration('company', id, action);
  }

  async moderateRole(id: string, action: 'Approved' | 'Rejected'): Promise<void> {
    const { error } = await this.db
      .from('roles')
      .update({ moderation_status: action })
      .eq('id', id);
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
    const { error } = await this.db
      .from('listing_reports')
      .update({ resolved: true })
      .eq('id', id);
    if (error) throw error;
  }

  async geocode(locationId: string): Promise<void> {
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

  async syncBatch(options: SyncBatchOptions = {}): Promise<SyncBatchResult> {
    const { data: sessionData } = await this.db.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      throw new Error('You must be signed in as an admin to run a sync.');
    }

    const params = new URLSearchParams();
    if (options.companyId) params.set('id', options.companyId);
    if (options.offset != null) params.set('offset', String(options.offset));
    if (options.limit != null) params.set('limit', String(options.limit));
    if (options.timeBudgetMs != null) params.set('timeBudgetMs', String(options.timeBudgetMs));

    const qs = params.toString();
    const res = await fetch(`/api/sync${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      let message = `Sync failed: HTTP ${res.status}`;
      if (res.status === 401)
        message = 'Sync failed: your session is not authenticated. Please sign in again.';
      else if (res.status === 403) message = 'Sync failed: your account is not an admin.';
      else {
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = `Sync failed: ${body.error}`;
        } catch {
          /* non-JSON error body */
        }
      }
      throw new Error(message);
    }
    const data = await res.json();
    if (Array.isArray(data)) {
      return {
        results: data as SyncResult[],
        syncedCount: data.length,
        nextOffset: null,
        totalCompanies: data.length,
        done: true,
      };
    }
    return data as SyncBatchResult;
  }

  async sync(companyId?: string): Promise<SyncResult[]> {
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
      if (res.status === 401)
        message = 'Sync failed: your session is not authenticated. Please sign in again.';
      else if (res.status === 403) message = 'Sync failed: your account is not an admin.';
      else {
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = `Sync failed: ${body.error}`;
        } catch {
          /* non-JSON error body */
        }
      }
      throw new Error(message);
    }
    const data = await res.json();
    if (Array.isArray(data)) return data as SyncResult[];
    if (data && Array.isArray((data as { results?: unknown[] }).results)) {
      return (data as { results: SyncResult[] }).results;
    }
    return [];
  }
}
