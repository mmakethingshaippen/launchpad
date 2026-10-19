/**
 * Vercel Serverless Function: POST /api/sync[?id=<companyId>]
 *
 * Runs the shared ATS sync engine server-side using the Supabase SERVICE ROLE
 * (bypasses RLS for upserts). Never exposed to the browser bundle. Applies the
 * bounded-concurrency + per-request timeout policy (refinement #4) via syncAll.
 *
 * Auth: requires the caller to be an admin. We verify the bearer token against
 * Supabase and check user_profiles.account_role = 'admin'.
 */
import { createClient } from '@supabase/supabase-js';
import { syncAll, type SyncSink, type UpsertRoleData, type SyncableCompany } from '../src/lib/ats/sync.js';

interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
}

function serviceClient() {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createClient(url, key, { auth: { persistSession: false } });
}

class SupabaseSink implements SyncSink {
  constructor(private db: ReturnType<typeof serviceClient>) {}

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
    await this.db.from('roles').upsert(row, { onConflict: 'company_id,external_job_id' });
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = serviceClient();

    // Admin check via bearer token.
    const authHeader = req.headers['authorization'];
    const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const jwt = token?.replace(/^Bearer /, '');
    if (!jwt) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { data: userData } = await db.auth.getUser(jwt);
    if (!userData.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { data: profile } = await db
      .from('user_profiles')
      .select('account_role')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (profile?.account_role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const id = new URLSearchParams((req.url ?? '').split('?')[1] ?? '').get('id');
    let q = db.from('companies').select('id,name,ats_provider,ats_board_token').neq('ats_provider', 'none');
    if (id) q = q.eq('id', id);
    const { data: companies } = await q;

    const targets: SyncableCompany[] = (companies ?? []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      name: c.name as string,
      atsProvider: c.ats_provider as SyncableCompany['atsProvider'],
      atsBoardToken: (c.ats_board_token as string) ?? null,
    }));

    const results = await syncAll(targets, new SupabaseSink(db), {});
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
