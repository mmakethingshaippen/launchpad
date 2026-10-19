/**
 * Vercel Serverless Function: POST /api/sync[?id=<companyId>]
 *
 * Runs the shared ATS sync engine server-side using the Supabase SERVICE ROLE
 * (bypasses RLS for upserts). Never exposed to the browser bundle. Applies the
 * bounded-concurrency + per-request timeout policy (refinement #4) via syncAll.
 *
 * Auth: requires the caller to be an admin. We verify the bearer token against
 * Supabase and check user_profiles.account_role = 'admin'.
 *
 * NOTE: This file is pre-bundled into a self-contained api/sync.js by
 * scripts/build-api.ts during `npm run build`, so the ../src/lib/ats/* imports
 * are inlined and Vercel's runtime never has to resolve relative TS paths.
 */
import { syncAll, type SyncableCompany } from '../../src/lib/ats/sync';
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../../src/lib/ats/supabaseSink';

interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = createServiceClient();

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
    let companies: SyncableCompany[];
    if (id) {
      // Load a single company by id.
      const { data } = await db
        .from('companies')
        .select('id,name,ats_provider,ats_board_token')
        .eq('id', id)
        .neq('ats_provider', 'none');
      companies = (data ?? []).map((c: Record<string, unknown>) => ({
        id: c.id as string,
        name: c.name as string,
        atsProvider: c.ats_provider as SyncableCompany['atsProvider'],
        atsBoardToken: (c.ats_board_token as string) ?? null,
      }));
    } else {
      companies = await loadSyncableCompanies(db);
    }

    const results = await syncAll(companies, new SupabaseSink(db), {});
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
