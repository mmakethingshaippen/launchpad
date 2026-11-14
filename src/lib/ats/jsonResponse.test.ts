// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readJsonResponse } from './jsonResponse';
import { createWorkdayClient } from './providers/workday';
import { syncAll, type SyncSink, type SyncableCompany, type UpsertRoleData } from './sync';
import type { FetchLike } from './types';

const ENDPOINT = 'https://target.wd5.myworkdayjobs.com/wday/cxs/target/targetcareers/jobs';
const MAINTENANCE_URL = 'https://community.workday.com/maintenance-page';

/** What Target's tenant returned in Nov 2026: the POST redirected to an HTML maintenance page with 200. */
function maintenancePage(): Response {
  const res = new Response('<!DOCTYPE html><html><head><title>Workday is currently unavailable.</title></head><body>x</body></html>', {
    status: 200, headers: { 'content-type': 'text/html; charset=UTF-8', server: 'Apache' },
  });
  Object.defineProperty(res, 'url', { value: MAINTENANCE_URL });
  return res;
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('readJsonResponse', () => {
  it('names a maintenance redirect instead of failing to parse HTML', async () => {
    const r = await readJsonResponse(maintenancePage(), ENDPOINT);
    expect(r).toEqual({ ok: false, kind: 'maintenance', status: 200, reason: 'maintenance (redirected to community.workday.com/maintenance-page)' });
  });
  it('separates unexpected HTML, challenges, transient errors, wrong endpoints and invalid JSON', async () => {
    const html = new Response('<html><head><title>Sign in</title></head></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect(await readJsonResponse(html, ENDPOINT)).toMatchObject({ kind: 'unexpected-html', reason: 'unexpected text/html' });
    expect(await readJsonResponse(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }), ENDPOINT)).toMatchObject({ kind: 'access-challenge' });
    expect(await readJsonResponse(new Response('', { status: 503 }), ENDPOINT)).toMatchObject({ kind: 'transient', reason: 'http-503' });
    expect(await readJsonResponse(json({ errorCode: 'S21' }, 404), ENDPOINT)).toMatchObject({ kind: 'incorrect-endpoint' });
    expect(await readJsonResponse(json({ errorCode: 'HTTP_422' }, 422), ENDPOINT)).toMatchObject({ kind: 'incorrect-endpoint' });
    expect(await readJsonResponse(new Response('{"total":', { status: 200, headers: { 'content-type': 'application/json' } }), ENDPOINT)).toMatchObject({ kind: 'invalid-json' });
    expect(await readJsonResponse(json({ total: 1 }), ENDPOINT)).toEqual({ ok: true, data: { total: 1 } });
  });
  it('never includes the response body in the reason', async () => {
    const r = await readJsonResponse(maintenancePage(), ENDPOINT);
    expect(JSON.stringify(r)).not.toMatch(/DOCTYPE|currently unavailable/);
  });
});

describe('Workday tenant under maintenance', () => {
  it('fails the board with a clear reason instead of a JSON parse error', async () => {
    const client = createWorkdayClient((async () => maintenancePage()) as unknown as FetchLike);
    await expect(client.fetchPostings('target.wd5.myworkdayjobs.com|target|targetcareers'))
      .rejects.toThrow('Workday target: maintenance: maintenance (redirected to community.workday.com/maintenance-page) on the first page');
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('neither refreshes nor closes Target jobs, and other employers still sync', async () => {
    const upserted: UpsertRoleData[] = [];
    const closedFor: string[] = [];
    const sink: SyncSink = {
      async upsertRole(row) { upserted.push(row); return 'imported'; },
      async closeMissing(companyId) { closedFor.push(companyId); return 0; },
    };
    const companies: SyncableCompany[] = [
      { id: 'co-target', name: 'Target', atsProvider: 'workday', atsBoardToken: 'target.wd5.myworkdayjobs.com|target|targetcareers' },
      { id: 'co-acme', name: 'Acme', atsProvider: 'greenhouse', atsBoardToken: 'acme' },
    ];
    const fetchImpl = (async (url: string) => {
      if (url.includes('myworkdayjobs')) return maintenancePage();
      return json({ jobs: [{ id: 1, title: 'Software Engineering Intern', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Austin, TX' }, content: '' }] });
    }) as unknown as typeof fetch;
    const results = await syncAll(companies, sink, { fetchImpl });
    const target = results.find((r) => r.company === 'Target')!;
    const acme = results.find((r) => r.company === 'Acme')!;
    expect(target.errors.join(' ')).toMatch(/maintenance/);
    expect(target.errors.join(' ')).not.toMatch(/Unexpected token/);
    expect(upserted.filter((r) => r.companyId === 'co-target')).toEqual([]);
    expect(closedFor).not.toContain('co-target');
    expect(acme.errors).toEqual([]);
    expect(upserted.filter((r) => r.companyId === 'co-acme')).toHaveLength(1);
  });
});
