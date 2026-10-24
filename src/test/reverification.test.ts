// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createReverificationHandler } from '../../api/_src/reverify-jobs';

function harness(options: { claims?: unknown[]; finish?: boolean; dbError?: boolean; syncError?: boolean } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (options.dbError) return { data: null, error: { code: 'missing_rpc' } };
    return { data: name === 'reverification_claim' ? options.claims ?? [] : options.finish ?? true, error: null };
  });
  const db = { rpc } as unknown as SupabaseClient;
  const createClient = vi.fn(() => db);
  const sync = vi.fn(async () => {
    if (options.syncError) throw new Error('Provider unavailable');
    return { company: 'Example', companyId: 'company-1', imported: 2, updated: 3, closed: 1, errors: [], warnings: ['Partial feed'] };
  });
  const handler = createReverificationHandler({ env: { CRON_SECRET: 'test-secret' }, createClient,
    loadCompany: async () => ({ id: 'company-1', name: 'Example', atsProvider: 'greenhouse', atsBoardToken: 'example' }),
    sync, log: vi.fn(),
  });
  let code = 0; let body: unknown;
  const res = { status(value: number) { code = value; return res; }, json(value: unknown) { body = value; }, setHeader: vi.fn() };
  return { handler, rpc, createClient, sync, res, result: () => ({ code, body }) };
}
const claim = { run_date: '2026-10-24', company_id: 'company-1', lease_token: 'lease-1', attempts: 1 };
describe('protected reverification worker', () => {
  it('rejects missing or incorrect credentials before opening the database', async () => {
    for (const authorization of [undefined, 'Bearer wrong', ['Bearer test-secret']]) {
      const test = harness();
      await test.handler({ method: 'POST', headers: { authorization } }, test.res);
      expect(test.result().code).toBe(401);
      expect(test.createClient).not.toHaveBeenCalled();
    }
  });
  it('rejects unsupported methods', async () => {
    const test = harness();
    await test.handler({ method: 'DELETE', headers: {} }, test.res);
    expect(test.result().code).toBe(405);
  });
  it('returns idle when the queue is empty', async () => {
    const test = harness();
    await test.handler({ method: 'POST', headers: { authorization: 'Bearer test-secret' } }, test.res);
    expect(test.result()).toEqual({ code: 200, body: { status: 'idle', processed: 0 } });
    expect(test.sync).not.toHaveBeenCalled();
  });
  it('starts today once before claiming the first manual batch', async () => {
    const test = harness({ claims: [claim] });
    await test.handler({ method: 'POST', url: '/api/reverify-jobs?start=1', headers: { authorization: 'Bearer test-secret' } }, test.res);
    expect(test.rpc.mock.calls.map(call => call[0])).toEqual(['start_job_reverification','reverification_claim','reverification_finish']);
    expect(test.result().code).toBe(200);
    expect(test.rpc).toHaveBeenLastCalledWith('reverification_finish', expect.objectContaining({
      p_lease_token: 'lease-1', p_result: expect.objectContaining({ imported: 2, errors: [], warnings: ['Partial feed'] }),
    }));
  });
  it('records provider failures for a retry', async () => {
    const test = harness({ claims: [claim], syncError: true });
    await test.handler({ method: 'POST', headers: { authorization: 'Bearer test-secret' } }, test.res);
    expect(test.result().code).toBe(503);
    expect(test.rpc).toHaveBeenLastCalledWith('reverification_finish', expect.objectContaining({
      p_result: expect.objectContaining({ errors: ['Provider unavailable'] }),
    }));
  });
  it('does not claim success when a lease result cannot be saved', async () => {
    const test = harness({ claims: [claim], finish: false });
    await test.handler({ method: 'POST', headers: { authorization: 'Bearer test-secret' } }, test.res);
    expect(test.result().code).toBe(503);
    expect(JSON.stringify(test.result().body)).toContain('unacknowledged');
  });
  it('returns a sanitized error when the SQL is not installed', async () => {
    const test = harness({ dbError: true });
    await test.handler({ method: 'POST', headers: { authorization: 'Bearer test-secret' } }, test.res);
    expect(test.result().code).toBe(500);
    expect(JSON.stringify(test.result().body)).not.toContain('test-secret');
  });
});
