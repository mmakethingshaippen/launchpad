/** Protected worker. Supabase Cron owns the midnight schedule and durable queue. */
import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, loadSyncableCompany, SupabaseSink } from '../../src/lib/ats/supabaseSink';
import { syncCompany, type SyncResult } from '../../src/lib/ats/sync';

interface Request {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Response {
  status(code: number): Response;
  json(body: unknown): void;
  setHeader?(name: string, value: string): void;
}
interface Claim {
  run_date: string;
  company_id: string;
  lease_token: string;
  attempts: number;
}
export interface WorkerDependencies {
  env: NodeJS.ProcessEnv;
  createClient: (fetchImpl: typeof fetch) => SupabaseClient;
  loadCompany: typeof loadSyncableCompany;
  sync: typeof syncCompany;
  fetchImpl: typeof fetch;
  budgetMs: number;
  log: (event: Record<string, unknown>) => void;
}

function authorized(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function boundFetch(fetchImpl: typeof fetch, deadline?: AbortSignal): typeof fetch {
  return (input, init) => {
    const signals = [AbortSignal.timeout(5_000)];
    if (deadline) signals.push(deadline);
    if (init?.signal) signals.push(init.signal);
    return fetchImpl(input, { ...init, signal: AbortSignal.any(signals) });
  };
}

export function createReverificationHandler(overrides: Partial<WorkerDependencies> = {}) {
  const deps: WorkerDependencies = {
    env: process.env,
    createClient: fetchImpl => createServiceClient(overrides.env ?? process.env, fetchImpl),
    loadCompany: loadSyncableCompany,
    sync: syncCompany,
    fetchImpl: fetch,
    budgetMs: 35_000,
    log: event => console.info(JSON.stringify(event)),
    ...overrides,
  };
  return async function handler(req: Request, res: Response): Promise<void> {
    res.setHeader?.('Cache-Control', 'no-store');
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.setHeader?.('Allow', 'GET, POST');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const secret = deps.env.CRON_SECRET;
    if (!secret) {
      res.status(503).json({ error: 'Job reverification is not configured: CRON_SECRET is missing.' });
      return;
    }
    if (!authorized(req.headers.authorization, secret)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      // Control requests outlive the work deadline so failures can be recorded.
      const control = deps.createClient(boundFetch(deps.fetchImpl));
      const start = new URL(req.url ?? '/', 'https://worker.invalid').searchParams.get('start') === '1';
      if (start) {
        if (req.method !== 'POST') {
          res.status(405).json({ error: 'Use POST to start a daily run.' });
          return;
        }
        const { error: startError } = await control.rpc('start_job_reverification', {});
        if (startError) throw startError;
      }
      const { data, error } = await control.rpc('reverification_claim', { p_limit: 8 });
      if (error) throw error;
      const claims = (data ?? []) as Claim[];
      if (!claims.length) {
        res.status(200).json({ status: 'idle', processed: 0 });
        return;
      }

      const deadline = AbortSignal.timeout(deps.budgetMs);
      const workDb = deps.createClient(boundFetch(deps.fetchImpl, deadline));
      const sink = new SupabaseSink(workDb);
      let next = 0;
      const outcomes: Array<{ companyId: string; status: string; errors: string[]; warnings: string[] }> = [];
      await Promise.all(Array.from({ length: Math.min(4, claims.length) }, async () => {
        while (next < claims.length) {
          const claim = claims[next++];
          let result: SyncResult;
          try {
            deadline.throwIfAborted();
            const company = await deps.loadCompany(workDb, claim.company_id);
            if (!company) throw new Error('Company is no longer an approved, configured ATS source.');
            result = await deps.sync(company, sink, {
              signal: deadline, timeoutMs: 20_000, fetchImpl: deps.fetchImpl,
            });
          } catch (error) {
            result = {
              company: '', companyId: claim.company_id, imported: 0, updated: 0, closed: 0,
              errors: [deadline.aborted ? 'Worker deadline reached; queued work will be retried.'
                : error instanceof Error ? error.message : 'Company synchronization failed.'],
            };
          }
          // Keep the database/log payload bounded even for a broken provider.
          const errors = result.errors.slice(0, 10).map(value => value.slice(0, 500));
          const warnings = (result.warnings ?? []).slice(0, 10).map(value => value.slice(0, 500));
          const { data: accepted, error: finishError } = await control.rpc('reverification_finish', {
            p_run_date: claim.run_date, p_company_id: claim.company_id,
            p_lease_token: claim.lease_token,
            p_result: { imported: result.imported, updated: result.updated, closed: result.closed, errors, warnings },
          });
          if (finishError || !accepted) {
            // Leave the lease for automatic recovery; never report persistence failure as success.
            outcomes.push({ companyId: claim.company_id, status: 'unacknowledged',
              errors: ['Could not record the result; the expired lease will be retried.'], warnings });
          } else {
            outcomes.push({ companyId: claim.company_id,
              status: errors.length ? (claim.attempts >= 3 ? 'failed' : 'retrying') : 'succeeded', errors, warnings });
          }
        }
      }));
      const failed = outcomes.some(item => item.status !== 'succeeded');
      deps.log({ event: 'job_reverification_batch', processed: outcomes.length,
        succeeded: outcomes.filter(item => item.status === 'succeeded').length,
        retryingOrFailed: outcomes.filter(item => item.status !== 'succeeded').length });
      res.status(failed ? 503 : 200).json({ status: failed ? 'needs_retry' : 'batch_complete',
        processed: outcomes.length, results: outcomes });
    } catch (error) {
      // Do not serialize credentials, headers, clients or environment variables.
      deps.log({ event: 'job_reverification_worker_error',
        code: typeof error === 'object' && error && 'code' in error ? String(error.code) : 'worker_error' });
      res.status(500).json({ error: 'Job reverification failed. Check the queue migration and server configuration.' });
    }
  };
}

export default createReverificationHandler();
