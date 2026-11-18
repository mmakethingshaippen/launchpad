import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FetchLike } from './types';
import type { SyncSink, SyncableCompany, UpsertRoleData } from './sync';
import { syncCompany, syncAll } from './sync';

/** In-memory sink that records roles keyed by (companyId, externalJobId). */
class MemorySink implements SyncSink {
  roles = new Map<string, UpsertRoleData & { status: string }>();

  private key(companyId: string, id: string) {
    return `${companyId}::${id}`;
  }

  async upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'> {
    const k = this.key(data.companyId, data.externalJobId);
    const existed = this.roles.has(k);
    this.roles.set(k, { ...data, status: 'Active' });
    return existed ? 'updated' : 'imported';
  }

  async closeMissing(companyId: string, liveIds: string[]): Promise<number> {
    let closed = 0;
    for (const v of this.roles.values()) {
      if (v.companyId !== companyId) continue;
      if (v.status !== 'Active') continue;
      if (!liveIds.includes(v.externalJobId)) {
        v.status = 'Closed';
        closed++;
      }
    }
    return closed;
  }
}

function fetchReturning(payload: unknown, status = 200): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
}

const greenhouseCompany: SyncableCompany = {
  id: 'c1',
  name: 'Acme',
  atsProvider: 'greenhouse',
  atsBoardToken: 'acme',
};

const NOW = new Date(Date.UTC(2026, 9, 1)); // Oct 1 2026

function ghPayload(jobs: Array<{ id: number; title: string; url?: string }>) {
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      absolute_url: j.url ?? `https://boards.greenhouse.io/acme/jobs/${j.id}`,
      content: '&lt;p&gt;desc&lt;/p&gt;',
      location: { name: 'Remote' },
    })),
  };
}

describe('syncCompany', () => {
  let sink: MemorySink;
  beforeEach(() => {
    sink = new MemorySink();
  });

  it('imports early-career roles and skips senior ones', async () => {
    const fetchImpl = fetchReturning(
      ghPayload([
        { id: 1, title: 'Summer 2027 Intern' },
        { id: 2, title: 'Senior Engineer' },
        { id: 3, title: 'New Grad Engineer' },
      ]),
    ) as unknown as typeof fetch;

    const r = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl });
    expect(r.imported).toBe(2); // intern + new grad, senior excluded
    expect(r.errors).toEqual([]);
  });

  it('dedups by external_job_id on re-sync (update, not duplicate)', async () => {
    const fetchImpl = fetchReturning(
      ghPayload([{ id: 1, title: 'Summer 2027 Intern' }]),
    ) as unknown as typeof fetch;

    const first = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl });
    expect(first.imported).toBe(1);
    const second = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl });
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(1);
    expect(sink.roles.size).toBe(1);
  });

  it('closes roles removed from the live feed (Req 19.4)', async () => {
    const full = fetchReturning(
      ghPayload([
        { id: 1, title: 'Summer 2027 Intern' },
        { id: 2, title: 'Fall 2027 Co-op' },
      ]),
    ) as unknown as typeof fetch;
    await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl: full });

    const reduced = fetchReturning(
      ghPayload([{ id: 1, title: 'Summer 2027 Intern' }]),
    ) as unknown as typeof fetch;
    const r = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl: reduced });
    expect(r.closed).toBe(1);
    expect(sink.roles.get('c1::2')?.status).toBe('Closed');
  });

  it('rejects postings with an invalid apply URL', async () => {
    const fetchImpl = fetchReturning(
      ghPayload([{ id: 1, title: 'Summer 2027 Intern', url: 'not-a-url' }]),
    ) as unknown as typeof fetch;
    const r = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl });
    expect(r.imported).toBe(0);
  });

  it('restricts internship-only employers to Internship/Co-op (Req 6)', async () => {
    const fetchImpl = fetchReturning(
      ghPayload([
        { id: 1, title: 'Summer 2027 Software Engineering Intern' },
        { id: 2, title: 'Fall 2027 Data Co-op' },
        { id: 3, title: 'New Grad Software Engineer' }, // Entry-level → dropped
      ]),
    ) as unknown as typeof fetch;

    const restricted: SyncableCompany = { ...greenhouseCompany, id: 'g', internshipOnly: true };
    const r = await syncCompany(restricted, sink, { now: NOW, fetchImpl });
    // Only the intern + co-op survive; the new-grad role is blocked.
    expect(r.imported).toBe(2);
    const titles = [...sink.roles.values()].map((v) => v.title);
    expect(titles).toContain('Summer 2027 Software Engineering Intern');
    expect(titles).toContain('Fall 2027 Data Co-op');
    expect(titles).not.toContain('New Grad Software Engineer');
  });

  it('rejects a posting whose title targets an expired past term (Req 7.2)', async () => {
    const fetchImpl = fetchReturning(
      ghPayload([
        { id: 1, title: 'Summer 2025 Intern' }, // past year → rejected
        { id: 2, title: 'Summer 2027 Intern' }, // future → kept
      ]),
    ) as unknown as typeof fetch;
    const r = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl });
    expect(r.imported).toBe(1);
    expect([...sink.roles.values()][0].title).toBe('Summer 2027 Intern');
  });

  it('does not close-missing when the fetch fails (avoids wiping data)', async () => {
    // seed one role
    const seed = fetchReturning(ghPayload([{ id: 1, title: 'Summer 2027 Intern' }])) as unknown as typeof fetch;
    await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl: seed });

    const failing = fetchReturning({}, 500) as unknown as typeof fetch;
    const r = await syncCompany(greenhouseCompany, sink, { now: NOW, fetchImpl: failing });
    expect(r.errors.length).toBeGreaterThan(0);
    expect(sink.roles.get('c1::1')?.status).toBe('Active'); // untouched
  });
});

describe('syncAll (bounded concurrency, isolation — refinement #4)', () => {
  it('allows a large scheduled board more time while preserving the default deadline for others', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (_url, init) => new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response(JSON.stringify(ghPayload([{ id: 1, title: 'Summer 2027 Intern' }])), { headers: { 'content-type': 'application/json' } })), 20);
        init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
      })) as typeof fetch;
      const pending = syncAll([
        { ...greenhouseCompany, id: 'large' },
        { ...greenhouseCompany, id: 'normal' },
      ], new MemorySink(), { fetchImpl, now: NOW, timeoutMs: 10, timeoutMsForCompany: company => company.id === 'large' ? 100 : undefined });
      await vi.advanceTimersByTimeAsync(120);
      const [large, normal] = await pending;
      expect(large.imported).toBe(1);
      expect(large.errors).toEqual([]);
      expect(normal.imported).toBe(0);
      expect(normal.errors).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('refreshes jobs downloaded before a Workday challenge, preserves unseen jobs and reports the blocked host', async () => {
    const sink = new MemorySink();
    let closeCalls = 0;
    sink.closeMissing = async () => { closeCalls++; return 0; };
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      if (requests > 1) return new Response('', { status: 429, headers: { 'cf-mitigated': 'challenge' } });
      return new Response(JSON.stringify({ total: 40, jobPostings: Array.from({ length: 20 }, (_, i) => ({
        title: `Summer 2027 Engineering Intern ${i}`, externalPath: `/job/Boise/Intern_JR${i}`, bulletFields: [`JR${i}`],
      })) }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const result = await syncCompany({
      id: 'example', name: 'Example', atsProvider: 'workday', atsBoardToken: 'example.wd1.myworkdayjobs.com|example|External',
    }, sink, { now: NOW, fetchImpl });
    expect(result).toMatchObject({ fetched: 20, candidates: 20, imported: 20, closed: 0,
      coverage: { status: 'blocked', host: 'example.wd1.myworkdayjobs.com' } });
    expect(result.warnings?.[0]).toMatch(/access-challenge/);
    expect(closeCalls).toBe(0);
    expect(requests).toBe(2);
  });

  it('isolates a failing company and still syncs the rest', async () => {
    const sink = new MemorySink();
    const companies: SyncableCompany[] = [
      { id: 'c1', name: 'Good', atsProvider: 'greenhouse', atsBoardToken: 'good' },
      { id: 'c2', name: 'Bad', atsProvider: 'greenhouse', atsBoardToken: 'bad' },
      { id: 'c3', name: 'None', atsProvider: 'none', atsBoardToken: null },
    ];

    // Per-company fetch: good returns a job, bad throws.
    const fetchImpl = (async (url: string) => {
      if (url.includes('/good/')) {
        return { ok: true, status: 200, json: async () => ghPayload([{ id: 1, title: 'Summer 2027 Intern' }]) };
      }
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const results = await syncAll(companies, sink, { now: NOW, fetchImpl, concurrency: 2 });
    // 'none' company is filtered out of targets
    expect(results).toHaveLength(2);
    const good = results.find((r) => r.company === 'Good')!;
    const bad = results.find((r) => r.company === 'Bad')!;
    expect(good.imported).toBe(1);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});
