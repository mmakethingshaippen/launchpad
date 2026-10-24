// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { syncCompany, type SyncSink } from './sync';
const company = { id: 'example', name: 'Example', atsProvider: 'greenhouse' as const, atsBoardToken: 'example' };
const job = { id: 1, title: 'Software Engineering Intern', absolute_url: 'https://example.com/1',
  content: '<p>Internship</p>', location: { name: 'Seattle, WA' } };
const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ jobs: [job] }), { status: 200 }));
function sink(): SyncSink {
  return { upsertRole: vi.fn(async () => 'updated' as const), closeMissing: vi.fn(async () => 0) };
}
describe('scheduled synchronization safety', () => {
  it.each(['greenhouse', 'lever', 'ashby'] as const)('rejects malformed %s responses without closing jobs', async atsProvider => {
    const db = sink();
    const result = await syncCompany({ ...company, atsProvider }, db, {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 200 }),
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(db.closeMissing).not.toHaveBeenCalled();
  });
  it('does not close live jobs when a database write fails', async () => {
    const db = sink(); db.upsertRole = vi.fn(async () => { throw new Error('database unavailable'); });
    const result = await syncCompany(company, db, { fetchImpl });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(db.closeMissing).not.toHaveBeenCalled();
  });
  it('stops after a worker deadline without closing jobs', async () => {
    const db = sink(); const controller = new AbortController();
    db.upsertRole = vi.fn(async () => { controller.abort(); return 'updated' as const; });
    const result = await syncCompany(company, db, { fetchImpl, signal: controller.signal });
    expect(result.errors.join(' ')).toContain('deadline');
    expect(db.closeMissing).not.toHaveBeenCalled();
  });
  it('uses bulk writes and keeps all feed ids for presence checks', async () => {
    const db = sink(); db.upsertRoles = vi.fn(async () => ({ imported: 1, updated: 0 }));
    const result = await syncCompany(company, db, { fetchImpl });
    expect(result.errors).toEqual([]);
    expect(db.upsertRoles).toHaveBeenCalledTimes(1);
    expect(db.upsertRole).not.toHaveBeenCalled();
    expect(db.closeMissing).toHaveBeenCalledWith(company.id, ['1']);
  });
  it('never interprets a failed provider request as an empty board', async () => {
    const db = sink();
    const result = await syncCompany(company, db, { fetchImpl: async () => new Response('', { status: 503 }) });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(db.closeMissing).not.toHaveBeenCalled();
  });
});
