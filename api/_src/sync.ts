/**
 * Vercel Serverless Function: POST /api/sync[?id=<companyId>&offset=<offset>&limit=<limit>&timeBudgetMs=<ms>]
 *
 * Runs the shared ATS sync engine server-side using the Supabase SERVICE ROLE
 * (bypasses RLS for upserts). Never exposed to the browser bundle. Applies the
 * bounded-concurrency + per-request timeout policy via syncAll.
 *
 * Auth: requires the caller to be an admin. We verify the bearer token against
 * Supabase and check user_profiles.account_role = 'admin'.
 *
 * Supports paginated batching and time budgeting to prevent Vercel 504 Gateway
 * Timeouts on large company rosters.
 *
 * NOTE: This file is pre-bundled into a self-contained api/sync.js by
 * scripts/build-api.ts / scripts/build-api.mjs during `npm run build`, so the
 * ../src/lib/ats/* imports are inlined and Vercel's runtime never has to
 * resolve relative TS paths.
 */
import { syncAll, type SyncableCompany, type SyncResult } from '../../src/lib/ats/sync';
import { createServiceClient, loadSyncableCompanies, SupabaseSink } from '../../src/lib/ats/supabaseSink';

interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
}

export interface SyncBatchResponse {
  results: SyncResult[];
  syncedCount: number;
  nextOffset: number | null;
  totalCompanies: number;
  done: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allowed callers:
  //   1. Vercel Cron: GET or POST with Authorization: Bearer <CRON_SECRET>.
  //   2. An admin user: POST with their Supabase access token.
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = createServiceClient();

    const authHeader = req.headers['authorization'];
    const token = (Array.isArray(authHeader) ? authHeader[0] : authHeader)?.replace(/^Bearer /, '');

    const cronSecret = process.env.CRON_SECRET;
    const isCron = Boolean(cronSecret && token && token === cronSecret);

    if (!isCron) {
      // Fall back to admin-user authorization.
      if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const { data: userData } = await db.auth.getUser(token);
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
    }

    const searchParams = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
    const id = searchParams.get('id');

    let bodyParams: Record<string, unknown> = {};
    if (typeof req.body === 'object' && req.body !== null) {
      bodyParams = req.body as Record<string, unknown>;
    } else if (typeof req.body === 'string') {
      try {
        bodyParams = JSON.parse(req.body);
      } catch {
        // non-JSON string body, ignore
      }
    }

    const offsetRaw = searchParams.get('offset') ?? bodyParams.offset;
    const limitRaw = searchParams.get('limit') ?? bodyParams.limit;
    const timeBudgetRaw = searchParams.get('timeBudgetMs') ?? bodyParams.timeBudgetMs;
    const isBatchRequest = offsetRaw != null || limitRaw != null;

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

    const totalCompanies = companies.length;

    // Single-company requests retain the legacy array response unless the caller
    // explicitly requests batch metadata.
    if (id) {
      const results = await syncAll(companies, new SupabaseSink(db), {});
      if (isBatchRequest) {
        const payload: SyncBatchResponse = {
          results,
          syncedCount: results.length,
          nextOffset: null,
          totalCompanies,
          done: true,
        };
        res.status(200).json(payload);
        return;
      }
      res.status(200).json(results);
      return;
    }

    const limit = Math.max(1, parseInt(String(limitRaw ?? 40), 10) || 40);
    // Manual batching uses the caller's explicit cursor. The midnight worker
    // has its own durable queue and never infers progress from wall-clock time.
    const offset = Math.max(0, parseInt(String(offsetRaw ?? 0), 10) || 0);
    const requestedBudget = Math.max(5000, parseInt(String(timeBudgetRaw ?? 45000), 10) || 45000);
    // Leave headroom for auth, database operations, and response serialization.
    const timeBudgetMs = Math.min(45000, requestedBudget);
    const batch = companies.slice(offset, offset + Math.min(40, limit));

    // Bound per-provider fetch time and run a modest pool to avoid one large
    // invocation overwhelming the serverless runtime or ATS providers.
    const results = await syncAll(batch, new SupabaseSink(db), {
      timeoutMs: Math.min(10000, timeBudgetMs),
      concurrency: 12,
    });

    const nextOffsetIndex = offset + batch.length;
    const done = nextOffsetIndex >= totalCompanies;
    const nextOffset = done ? null : nextOffsetIndex;

    const payload: SyncBatchResponse = {
      results,
      syncedCount: results.length,
      nextOffset,
      totalCompanies,
      done,
    };

    res.status(200).json(payload);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
