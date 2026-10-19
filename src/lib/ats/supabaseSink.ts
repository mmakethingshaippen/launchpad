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
    const row = {
      company_id: data.companyId,
      external_job_id: data.externalJobId,
      slug,
      title: data.title,
      seasons: data.seasons,
      cohort_year: data.cohortYear,
      city: data.city ?? null,
      state: data.state ?? null,
      country: data.country ?? null,
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
    const { error } = await this.db.from('roles').upsert(row, { onConflict: 'company_id,external_job_id' });
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
  let q = db.from('companies').select('id,name,ats_provider,ats_board_token').neq('ats_provider', 'none');
  if (slug) q = q.eq('slug', slug);
  const { data, error } = await q;
  if (error) throw new Error(`load companies: ${error.message}`);
  return (data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    atsProvider: c.ats_provider as SyncableCompany['atsProvider'],
    atsBoardToken: (c.ats_board_token as string) ?? null,
  }));
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
