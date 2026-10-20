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

export function createServiceClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing Supabase service credentials. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export class SupabaseSink implements SyncSink {
  constructor(private db: SupabaseClient) {}

  async upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'> {
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
    const { data: existing } = await this.db
      .from('roles')
      .select('id')
      .eq('company_id', data.companyId)
      .eq('external_job_id', data.externalJobId)
      .maybeSingle();

    let { error } = await this.db.from('roles').upsert(row, { onConflict: 'company_id,external_job_id' });

    // Graceful degradation: if the role-coordinate columns haven't been added
    // yet (migration 0003 not applied), retry without them so classification
    // and other fields still sync. Map pins populate after the migration runs.
    if (error && /latitude|longitude/.test(error.message) && /column/i.test(error.message)) {
      const { latitude: _lat, longitude: _lng, ...rest } = row;
      void _lat;
      void _lng;
      ({ error } = await this.db.from('roles').upsert(rest, { onConflict: 'company_id,external_job_id' }));
    }
    if (error) throw new Error(`upsert role ${data.externalJobId}: ${error.message}`);
    return existing ? 'updated' : 'imported';
  }

  async closeMissing(companyId: string, liveIds: string[]): Promise<number> {
    const { data } = await this.db
      .from('roles')
      .select('id, external_job_id')
      .eq('company_id', companyId)
      .eq('source', 'ats')
      .eq('listing_status', 'Active');
    const toClose = (data ?? []).filter(
      (r: { external_job_id: string | null }) => r.external_job_id && !liveIds.includes(r.external_job_id),
    );
    for (const r of toClose) {
      await this.db.from('roles').update({ listing_status: 'Closed' }).eq('id', (r as { id: string }).id);
    }
    return toClose.length;
  }
}

/** Load approved, ATS-enabled companies from the database as sync targets. */
export async function loadSyncableCompanies(
  db: SupabaseClient,
  slug?: string,
): Promise<SyncableCompany[]> {
  let q = db
    .from('companies')
    .select(
      'id,name,ats_provider,ats_board_token,fields,company_locations(city,state,country,latitude,longitude,location_type)',
    )
    .neq('ats_provider', 'none');
  if (slug) q = q.eq('slug', slug);
  const { data, error } = await q;
  if (error) throw new Error(`load companies: ${error.message}`);
  return (data ?? []).map((c: Record<string, unknown>) => {
    const fields = (c.fields as FieldType[]) ?? [];
    const locs = (c.company_locations as Array<Record<string, unknown>>) ?? [];
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
    };
  });
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
