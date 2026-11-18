import { describe, expect, it, vi } from 'vitest';
import { createOfficialCareersClient } from './officialCareers';
import { syncCompany } from '../sync';
import type { FetchLike } from '../types';

const TOKEN = 'micron.wd1.myworkdayjobs.com|micron|External';
const createMicronClient = (fetchImpl: FetchLike) => createOfficialCareersClient(TOKEN, fetchImpl);
const position = (id: number, atsJobId = `JR${id}`) => ({
  id, atsJobId, name: 'Intern - Software Engineer', locations: ['Boise, Idaho, United States of America'],
  workLocationOption: 'onsite',
});
const response = (positions: unknown[], count: number) => ({
  ok: true, status: 200, json: async () => ({ status: 200, data: { positions, count } }),
});
const testClient = (fetchImpl: FetchLike) => createMicronClient((url, init) =>
  new URL(url).searchParams.get('filter_seniority') !== '0' ? Promise.resolve(response([], 0)) : fetchImpl(url, init));

describe('Micron official careers', () => {
  it('uses HP’s official host and domain while keeping its Workday requisition identity', async () => {
    const hpToken = 'hp.wd5.myworkdayjobs.com|hp|ExternalCareerSite';
    const calls: string[] = [];
    const client = createOfficialCareersClient(hpToken, async url => {
      calls.push(url);
      const params = new URL(url).searchParams;
      expect(params.getAll('filter_seniority')).toEqual(['internship', 'graduate']);
      return response(params.get('start') === '0' ? [position(123, 'UNI4519')] : [], 1);
    });
    const rows = await client.fetchPostings(hpToken);
    expect(rows).toHaveLength(1);
    expect(client.toNormalized(rows[0])).toMatchObject({ externalJobId: 'UNI4519', applyUrl: 'https://apply.hp.com/careers/job/123' });
    expect(calls.every(url => new URL(url).hostname === 'apply.hp.com' && new URL(url).searchParams.get('domain') === 'hp.com')).toBe(true);
    expect(client.getFetchCoverage?.()).toMatchObject({ status: 'filtered', host: 'apply.hp.com' });
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('reads beyond a short page, keeps the JR identity and uses the official job URL', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async url => {
      calls.push(url);
      const start = Number(new URL(url).searchParams.get('start'));
      return response(start === 0 ? [position(1)] : start === 1 ? [position(2)] : [], 2);
    };
    const client = testClient(fetchImpl);
    const rows = await client.fetchPostings(TOKEN);
    expect(calls.map(u => new URL(u).searchParams.get('start'))).toEqual(['0', '1', '2']);
    expect(calls.every(u => new URL(u).searchParams.get('sort_by') === 'timestamp')).toBe(true);
    expect(client.toNormalized(rows[0])).toMatchObject({
      externalJobId: 'JR1', applyUrl: 'https://careers.micron.com/careers/job/1',
      city: 'Boise', state: 'Idaho', country: 'United States of America', workArrangement: 'Onsite',
    });
    expect(client.getFetchCoverage?.().status).toBe('filtered');
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it.each(['repeated', 'short', 'changed', 'malformed'])('preserves observed jobs but reports %s pagination as partial', async failure => {
    let calls = 0;
    const client = testClient(async () => {
      if (++calls === 1) return response([position(1)], 2);
      if (failure === 'repeated') return response([position(1)], 2);
      if (failure === 'changed') return response([position(2)], 3);
      if (failure === 'malformed') return response([{ id: 2, name: 'Intern' }], 2);
      return response([], 2);
    });
    expect(await client.fetchPostings(TOKEN)).toHaveLength(failure === 'changed' ? 2 : 1);
    expect(client.getFetchCoverage?.().status).toBe('partial');
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('deduplicates overlapping pages without skipping the later pages or duplicating JR requisitions', async () => {
    const starts: string[] = [];
    const client = testClient(async url => {
      const start = new URL(url).searchParams.get('start')!;
      starts.push(start);
      return response(start === '0' ? [position(1), position(2)] : start === '2' ? [position(2), position(3)] : [], 3);
    });
    expect((await client.fetchPostings(TOKEN)).map(row => row.atsJobId)).toEqual(['JR1', 'JR2', 'JR3']);
    expect(starts).toEqual(['0', '2', '4']);
    expect(client.getFetchCoverage?.().status).toBe('filtered');
  });

  it('stops immediately on an explicit challenge and retains earlier observations', async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response([position(1)], 2))
      .mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'cf-mitigated': 'challenge' }), json: async () => ({}) });
    const client = testClient(fetchImpl);
    expect(await client.fetchPostings(TOKEN)).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(client.getFetchCoverage?.().status).toBe('blocked');
  });

  it('fails instead of treating a first-page error as an empty board', async () => {
    const client = testClient(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    await expect(client.fetchPostings(TOKEN)).rejects.toThrow('http-403');
  });

  it('prioritizes internships and retains them if another early-career search later fails', async () => {
    const queries: string[] = [];
    const client = createMicronClient(async url => {
      const params = new URL(url).searchParams;
      queries.push(params.get('filter_seniority')!);
      if (params.get('filter_seniority') !== '0') return { ok: false, status: 403, json: async () => ({}) };
      return response(params.get('start') === '0' ? [position(1)] : [], 1);
    });
    expect(await client.fetchPostings(TOKEN)).toHaveLength(1);
    expect(queries).toEqual(['0', '0', '1']);
    expect(client.getFetchCoverage?.().status).toBe('partial');
  });

  it('routes only Micron through careers, updates the existing identity, and never closes absent jobs', async () => {
    const sink = { upsertRole: vi.fn().mockResolvedValue('updated'), closeMissing: vi.fn() };
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(response([position(1, 'JR114537')], 1))
      .mockResolvedValue(response([], 1));
    const result = await syncCompany({ id: 'micron', name: 'Micron', atsProvider: 'workday', atsBoardToken: TOKEN }, sink, {
      fetchImpl: fetchImpl as unknown as typeof fetch, now: new Date('2026-11-17T00:00:00Z'),
    });
    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([]);
    expect(sink.upsertRole).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'micron', externalJobId: 'JR114537' }));
    expect(sink.closeMissing).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.every(([url]) => new URL(url).hostname === 'careers.micron.com')).toBe(true);
    const otherFetch = vi.fn<FetchLike>().mockResolvedValue({ ok: true, status: 200, json: async () => ({ total: 0, jobPostings: [] }) });
    await syncCompany({ id: 'other', name: 'Other', atsProvider: 'workday', atsBoardToken: 'other.wd1.myworkdayjobs.com|other|External' }, sink, { fetchImpl: otherFetch as unknown as typeof fetch });
    expect(otherFetch.mock.calls.every(([url]) => new URL(url).hostname === 'other.wd1.myworkdayjobs.com')).toBe(true);
  });
});
