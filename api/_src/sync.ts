
import {
  syncAll,
  type SyncableCompany,
  type SyncResult,
} from '../../src/lib/ats/sync';

import {
  createServiceClient,
  loadSyncableCompanies,
  loadSyncableCompany,
  SupabaseSink,
} from '../../src/lib/ats/supabaseSink';

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

const BATCH_SIZE = 8;
const MAX_BUDGET_MS = 45_000;

function parseNumber(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(max, Math.max(min, Math.floor(value)));
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const db = createServiceClient();

    const authHeader = req.headers.authorization;

    const token = (
      Array.isArray(authHeader)
        ? authHeader[0]
        : authHeader
    )?.replace(/^Bearer /i, '');

    const cronSecret = process.env.CRON_SECRET;
    const isCron = Boolean(
      cronSecret && token && token === cronSecret,
    );

    if (!isCron) {
      if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { data: userData, error: userError } =
        await db.auth.getUser(token);

      if (userError || !userData.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { data: profile, error: profileError } =
        await db
          .from('user_profiles')
          .select('account_role')
          .eq('id', userData.user.id)
          .maybeSingle();

      if (profileError || profile?.account_role !== 'admin') {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }

      if (req.method !== 'POST') {
        res.status(405).json({
          error: 'Admin sync requires POST',
        });
        return;
      }
    }

    const searchParams = new URLSearchParams(
      (req.url ?? '').split('?')[1] ?? '',
    );

    let body: Record<string, unknown> = {};

    if (req.body && typeof req.body === 'object') {
      body = req.body as Record<string, unknown>;
    } else if (typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body) as unknown;
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = {};
      }
    }

    const id = searchParams.get('id');

    const offset = parseNumber(
      searchParams.get('offset') ?? body.offset,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );

    const limit = parseNumber(
      searchParams.get('limit') ?? body.limit,
      BATCH_SIZE,
      1,
      BATCH_SIZE,
    );

    const timeBudgetMs = parseNumber(
      searchParams.get('timeBudgetMs') ??
        body.timeBudgetMs,
      MAX_BUDGET_MS,
      5_000,
      MAX_BUDGET_MS,
    );

    let companies: SyncableCompany[];

    if (id) {
      const company = await loadSyncableCompany(db, id);
      companies = company ? [company] : [];
    } else {
      companies = await loadSyncableCompanies(db);
    }

    const totalCompanies = companies.length;

    if (id && companies.length === 0) {
      res.status(404).json({
        error:
          'Company is not approved or has no configured ATS source.',
      });
      return;
    }

    const batch = id
      ? companies
      : companies.slice(offset, offset + limit);

    const results = await syncAll(
      batch,
      new SupabaseSink(db),
      {
        timeoutMs: Math.min(20_000, timeBudgetMs),
        concurrency: 4,
      },
    );

    const nextIndex = id
      ? totalCompanies
      : offset + batch.length;

    // Always produce a boolean, not string | boolean.
    const done =
      Boolean(id) || nextIndex >= totalCompanies;

    const response: SyncBatchResponse = {
      results,
      syncedCount: results.length,
      nextOffset: done ? null : nextIndex,
      totalCompanies,
      done,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('ATS sync request failed', {
      message:
        error instanceof Error
          ? error.message
          : 'Unknown error',
    });

    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : 'Synchronization failed',
    });
  }
}
