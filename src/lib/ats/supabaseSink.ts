/**
 * Shared Supabase persistence for the ATS sync engine.
 *
 * One implementation of SyncSink + helpers used by:
 *   - scripts/seed.ts            (insert seed companies + locations)
 *   - scripts/sync-ats-jobs.ts   (CLI live ingestion)
 *   - api/sync.ts                (Vercel serverless, admin-gated)
 *
 * Server-side only. Uses the service role to bypass RLS for trusted writes.
 * Kept free of any browser-only imports so @vercel/node and tsx resolve it cleanly.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SyncSink, UpsertRoleData, SyncableCompany } from './sync';
import type { SeedCompany } from '../../data/seed-companies';
import type { FieldType } from '../adapter/types';
import { classifyField } from './classify';
import { resolveRoleCoords, isRemoteLocation } from './cityCoords';
import { INTERNSHIP_ONLY_SLUGS } from './companyMatch';

/**
 * A role "city" is only usable as a display location when it names a real place.
 * Reject empties, "N/A"/"Location N/A", and multi-office counts like
 * "2 Locations" / "3 locations" / "Multiple Locations" that Workday returns.
 */
export function isUsableCity(city: string | null | undefined): boolean {
  if (!city) return false;
  const c = city.trim();
  if (!c) return false;
  if (/^(location\s*)?n\/?a$/i.test(c)) return false;
  if (/^\d+\s+locations?$/i.test(c)) return false;
  if (/^(multiple|various)\s+locations?$/i.test(c)) return false;
  if (/\blocations?\b/i.test(c) && /^\s*\d/.test(c)) return false;
  return true;
}

export function createServiceClient(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): SupabaseClient {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing Supabase service credentials. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}

function toRoleRow(data: UpsertRoleData) {
    const slug = `${data.companyId}-${data.externalJobId}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();

    // Refine the field with the company fallback for ambiguous titles.
    const field =
      data.field !== 'Other'
        ? data.field
        : classifyField(data.title, data.companyFallbackField, data.employmentTypeRaw);

    // Display location: use the role's own city when it's a real place; otherwise
    // fall back to the company HQ so a card never shows "Location N/A". Workday in
    // particular returns empty text, "N/A", or multi-office counts ("2 Locations").
    const remote = data.workArrangement === 'Remote';
    let displayCity = isUsableCity(data.city) ? data.city! : null;
    let displayState = displayCity ? (data.state ?? null) : null;
    let displayCountry = displayCity ? (data.country ?? null) : null;
    if (!remote && !displayCity && isUsableCity(data.companyHqCity)) {
      displayCity = data.companyHqCity!;
      displayState = data.companyHqState ?? null;
      displayCountry = data.companyHqCountry ?? null;
    }

    // Resolve real coordinates from the (possibly HQ-filled) display location,
    // else the company HQ coords.
    const locationString = [displayCity, displayState, displayCountry].filter(Boolean).join(', ');
    const effectiveRemote = remote || isRemoteLocation(locationString);
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (!effectiveRemote) {
      const resolved = resolveRoleCoords(locationString || displayCity || null);
      if (resolved) {
        latitude = resolved.latitude;
        longitude = resolved.longitude;
      }
    }
    if (latitude == null && data.companyHqLatitude != null && data.companyHqLongitude != null) {
      latitude = data.companyHqLatitude;
      longitude = data.companyHqLongitude;
    }

    const row = {
      company_id: data.companyId,
      external_job_id: data.externalJobId,
      slug,
      title: data.title,
      field,
      opportunity_type: data.opportunityType,
      degree_levels: data.degreeLevels,
      seasons: data.seasons,
      cohort_year: data.cohortYear,
      city: displayCity,
      state: displayState,
      country: displayCountry,
      latitude,
      longitude,
      work_arrangement: data.workArrangement ?? 'Onsite',
      application_deadline: data.deadline ? data.deadline.slice(0, 10) : null,
      apply_url: data.applyUrl,
      description: data.descriptionHtml,
      pay_min: data.pay?.min ?? null,
      pay_max: data.pay?.max ?? null,
      pay_currency: data.pay?.currency ?? null,
      pay_period: data.pay?.period ?? null,
      compensation_status: data.pay ? 'Paid' : 'Not disclosed',
      source: 'ats',
      source_url: data.applyUrl,
      moderation_status: 'Approved',
      listing_status: 'Active',
      last_verified_at: new Date().toISOString(),
    };
    return row;
}

interface StoredRoleId {
  id: string;
  external_job_id: string | null;
}

export class SupabaseSink implements SyncSink {
  private existingIds = new Map<string, Promise<Set<string>>>();

  constructor(private db: SupabaseClient) {}

  private async readRoleIds(companyId: string, activeOnly = false): Promise<StoredRoleId[]> {
    const rows: StoredRoleId[] = [];
    let cursor: string | undefined;
    for (;;) {
      let query = this.db.from('roles').select('id,external_job_id')
        .eq('company_id', companyId).order('id', { ascending: true }).limit(1000);
      if (activeOnly) query = query.eq('source', 'ats').eq('listing_status', 'Active');
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw new Error(`read role IDs: ${error.message}`);
      const page = (data ?? []) as StoredRoleId[];
      if (page.length === 0) return rows;
      const next = page[page.length - 1].id;
      if (!next || next === cursor) throw new Error('Role pagination made no progress.');
      rows.push(...page);
      cursor = next;
      // Do not stop on a short page: a project may configure an API limit below 1000.
    }
  }

  private roleIds(companyId: string): Promise<Set<string>> {
    let ids = this.existingIds.get(companyId);
    if (!ids) {
      ids = this.readRoleIds(companyId).then((rows) => new Set(
        rows.flatMap((row) => row.external_job_id ? [row.external_job_id] : []),
      ));
      this.existingIds.set(companyId, ids);
    }
    return ids;
  }

  async upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'> {
    const counts = await this.upsertRoles([data]);
    return counts.imported ? 'imported' : 'updated';
  }

  async upsertRoles(data: UpsertRoleData[]): Promise<{ imported: number; updated: number }> {
    const unique = [...new Map(data.map((row) => [
      `${row.companyId}\u0000${row.externalJobId}`, row,
    ])).values()];
    if (!unique.length) return { imported: 0, updated: 0 };
    const known = new Map<string, Set<string>>();
    for (const companyId of new Set(unique.map((row) => row.companyId))) {
      known.set(companyId, await this.roleIds(companyId));
    }
    const rows = unique.map(toRoleRow);
    let { error } = await this.db.from('roles').upsert(rows, { onConflict: 'company_id,external_job_id' });
    // Older databases may not yet have migration 0003's coordinate columns.
    if (error && /latitude|longitude/.test(error.message) && /column/i.test(error.message)) {
      const withoutCoordinates = rows.map(({ latitude: _lat, longitude: _lng, ...rest }) => {
        void _lat;
        void _lng;
        return rest;
      });
      ({ error } = await this.db.from('roles').upsert(withoutCoordinates, { onConflict: 'company_id,external_job_id' }));
    }
    if (error) throw new Error(`upsert roles: ${error.message}`);
    const counts = { imported: 0, updated: 0 };
    for (const row of unique) {
      const ids = known.get(row.companyId)!;
      if (ids.has(row.externalJobId)) counts.updated++;
      else counts.imported++;
      ids.add(row.externalJobId);
    }
    return counts;
  }

  async closeMissing(companyId: string, liveIds: string[]): Promise<number> {
    const live = new Set(liveIds);
    const rows = await this.readRoleIds(companyId, true);
    const toClose = rows.filter((row) => row.external_job_id && !live.has(row.external_job_id));
    let closed = 0;
    for (let offset = 0; offset < toClose.length; offset += 200) {
      const ids = toClose.slice(offset, offset + 200).map((row) => row.id);
      const { error, count } = await this.db.from('roles')
        .update({ listing_status: 'Closed' }, { count: 'exact' })
        .eq('company_id', companyId).eq('source', 'ats').eq('listing_status', 'Active')
        .in('id', ids);
      if (error) throw new Error(`close missing roles: ${error.message}`);
      closed += count ?? 0;
    }
    return closed;
  }
}

/** Load approved, ATS-enabled companies from the database as sync targets. */
const SYNC_COMPANY_SELECT =
  'id,slug,name,ats_provider,ats_board_token,fields,company_locations(city,state,country,latitude,longitude,location_type)';

export async function loadSyncableCompanies(
  db: SupabaseClient,
  slug?: string,
): Promise<SyncableCompany[]> {
  const allRows: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  // Supabase/PostgREST applies a default maximum row count to select queries.
  // Page explicitly so large company rosters are not silently truncated.
  for (;;) {
    let q = db
      .from('companies')
      .select(SYNC_COMPANY_SELECT)
      .eq('moderation_status', 'Approved')
      .neq('ats_provider', 'none')
      .not('ats_board_token', 'is', null)
      .neq('ats_board_token', '')
      .order('id', { ascending: true }).limit(1000);
    if (slug) q = q.eq('slug', slug);
    if (cursor) q = q.gt('id', cursor);
    const { data, error } = await q;
    if (error) throw new Error(`load companies: ${error.message}`);
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) break;
    const next = rows[rows.length - 1].id as string;
    if (!next || next === cursor) throw new Error('Company pagination made no progress.');
    allRows.push(...rows);
    cursor = next;
  }

  return allRows.map(mapSyncableCompany);
}

export async function loadSyncableCompany(
  db: SupabaseClient,
  id: string,
): Promise<SyncableCompany | null> {
  const { data, error } = await db.from('companies').select(SYNC_COMPANY_SELECT)
    .eq('id', id).eq('moderation_status', 'Approved').neq('ats_provider', 'none')
    .not('ats_board_token', 'is', null).neq('ats_board_token', '').maybeSingle();
  if (error) throw new Error(`load company: ${error.message}`);
  return data ? mapSyncableCompany(data as Record<string, unknown>) : null;
}

export function mapSyncableCompany(c: Record<string, unknown>): SyncableCompany {
    const fields = Array.isArray(c.fields) ? c.fields as FieldType[] : [];
    const locs = Array.isArray(c.company_locations) ? c.company_locations as Array<Record<string, unknown>> : [];
    // Prefer the HQ location; fall back to the first with coordinates.
    const hq =
      locs.find((l) => l.location_type === 'HQ' && l.latitude != null) ??
      locs.find((l) => l.latitude != null) ??
      locs.find((l) => l.location_type === 'HQ') ??
      locs[0];
    return {
      id: c.id as string,
      name: c.name as string,
      atsProvider: c.ats_provider as SyncableCompany['atsProvider'],
      atsBoardToken: (c.ats_board_token as string) ?? null,
      fallbackField: fields[0],
      hqLatitude: (hq?.latitude as number) ?? null,
      hqLongitude: (hq?.longitude as number) ?? null,
      hqCity: (hq?.city as string) ?? null,
      hqState: (hq?.state as string) ?? null,
      hqCountry: (hq?.country as string) ?? null,
      internshipOnly: INTERNSHIP_ONLY_SLUGS.has(c.slug as string),
    };
}

export interface SeedReportRow {
  name: string;
  status: 'inserted' | 'updated' | 'error';
  message?: string;
}

/**
 * Upsert seed companies and their locations into Supabase as Approved records.
 * Idempotent: re-running updates existing rows (matched by slug) rather than
 * creating duplicates. Never fabricates roles — roles come only from sync.
 */
export async function seedCompanies(
  db: SupabaseClient,
  companies: SeedCompany[],
): Promise<SeedReportRow[]> {
  const report: SeedReportRow[] = [];

  for (const c of companies) {
    try {
      const companyRow = {
        slug: c.slug,
        name: c.name,
        logo_url: c.logoUrl ?? null,
        website_url: c.websiteUrl,
        careers_url: c.careersUrl,
        description: c.description,
        fields: c.fields,
        company_type: c.companyType,
        startup_stage: c.startupStage ?? null,
        employee_count_range: c.employeeCountRange ?? null,
        founding_year: c.foundingYear ?? null,
        degree_levels: c.degreeLevels,
        ats_provider: c.atsProvider,
        ats_board_token: c.atsBoardToken,
        source: 'seed',
        moderation_status: 'Approved',
        last_verified_at: new Date().toISOString(),
      };

      // Does the company already exist?
      const { data: existing } = await db.from('companies').select('id').eq('slug', c.slug).maybeSingle();

      const { data: upserted, error: upsertErr } = await db
        .from('companies')
        .upsert(companyRow, { onConflict: 'slug' })
        .select('id')
        .single();
      if (upsertErr) throw new Error(upsertErr.message);

      const companyId = (upserted as { id: string }).id;

      // Replace locations for this company (idempotent).
      await db.from('company_locations').delete().eq('company_id', companyId);
      if (c.locations.length) {
        const locRows = c.locations.map((l) => ({
          company_id: companyId,
          city: l.city,
          state: l.state ?? null,
          country: l.country,
          latitude: l.latitude,
          longitude: l.longitude,
          location_type: l.locationType ?? 'HQ',
        }));
        const { error: locErr } = await db.from('company_locations').insert(locRows);
        if (locErr) throw new Error(`locations: ${locErr.message}`);
      }

      report.push({ name: c.name, status: existing ? 'updated' : 'inserted' });
    } catch (err) {
      report.push({
        name: c.name,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return report;
}
