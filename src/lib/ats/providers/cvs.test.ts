import { describe, expect, it, vi } from 'vitest';
import { createCvsClient } from './cvs';
import { syncCompany } from '../sync';
import type { FetchLike } from '../types';

const TOKEN = 'cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers';
const job = (id: number) => ({ reqId: `R${id}`, jobId: `R${id}`, title: 'Pharmacy Intern - Grad', city: 'Hayward', state: 'California', country: 'United States',
  applyUrl: `https://cvshealth.wd1.myworkdayjobs.com/CVS_Health_Careers/job/CA---Hayward/Pharmacy-Intern_R${id}/apply` });
const response = (jobs: unknown[], totalHits: number) => new Response(`<script>phApp.ddo = ${JSON.stringify({ eagerLoadRefineSearch: { status: 200, totalHits, data: { jobs } }, other: { text: 'A }; brace, a "quote", and a backslash \\' } })};</script>`);

describe('CVS official public search', () => {
  it('preserves the search keyword on every page and matches original requisitions', async () => {
    const urls: string[] = [];
    const client = createCvsClient(async url => {
      urls.push(url);
      return response([job(urls.length)], 2);
    });
    const rows = await client.fetchPostings(TOKEN);
    expect(rows).toHaveLength(2);
    expect(urls.map(url => new URL(url).searchParams.get('from'))).toEqual(['0', '1']);
    expect(urls.every(url => new URL(url).searchParams.get('keywords') === 'intern')).toBe(true);
    expect(urls.every(url => !new URL(url).searchParams.has('s'))).toBe(true);
    expect(client.toNormalized(rows[0])).toMatchObject({ externalJobId: 'R1', city: 'Hayward', title: 'Pharmacy Intern - Grad' });
    expect(client.getFetchCoverage?.().status).toBe('filtered');
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it.each(['repeated', 'truncated', 'blocked', 'untrusted'])('retains observed jobs and reports %s pages as incomplete', async failure => {
    let count = 0;
    const client = createCvsClient(async () => {
      if (++count === 1) return response([job(1)], 3);
      if (failure === 'truncated') return new Response('<script>phApp.ddo = {');
      if (failure === 'blocked') return new Response('', { status: 429, headers: { 'cf-mitigated': 'challenge' } });
      if (failure === 'untrusted') return response([{ ...job(2), applyUrl: 'https://example.com/job' }], 3);
      return response([job(1)], 3);
    });
    expect(await client.fetchPostings(TOKEN)).toHaveLength(1);
    expect(count).toBe(failure === 'untrusted' ? 3 : 2);
    expect(client.getFetchCoverage?.().status).toBe(failure === 'blocked' ? 'blocked' : 'partial');
  });

  it('skips an unmapped posting and still refreshes jobs on later pages', async () => {
    let page = 0;
    const client = createCvsClient(async () => response(++page === 1 ? [{ ...job(1), applyUrl: 'https://example.com/apply' }] : [job(2)], 2));
    expect((await client.fetchPostings(TOKEN)).map(row => row.reqId)).toEqual(['R2']);
    expect(client.getFetchCoverage?.()).toMatchObject({ status: 'partial', reason: expect.stringContaining('1 postings') });
  });

  it('does not interpret an HTML error page as an empty board', async () => {
    const client = createCvsClient(async () => new Response('<html>Unavailable</html>'));
    await expect(client.fetchPostings(TOKEN)).rejects.toThrow('Missing public search data');
  });

  it('accepts Workday location suffixes without changing the requisition ID', async () => {
    const client = createCvsClient(async () => response([{ ...job(1), applyUrl: job(1).applyUrl.replace('_R1/apply', '_R1-1/apply') }], 1));
    const rows = await client.fetchPostings(TOKEN);
    expect(client.toNormalized(rows[0])?.externalJobId).toBe('R1');
  });

  it('updates existing jobs through the shared sync without closing jobs outside this search', async () => {
    const sink = { upsertRole: vi.fn().mockResolvedValue('updated'), closeMissing: vi.fn() };
    const fetchImpl: FetchLike = async () => response([job(1092730)], 1);
    const result = await syncCompany({ id: 'cvs', name: 'CVS', atsProvider: 'workday', atsBoardToken: TOKEN }, sink,
      { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.updated).toBe(1);
    expect(sink.upsertRole).toHaveBeenCalledWith(expect.objectContaining({ externalJobId: 'R1092730', companyId: 'cvs' }));
    expect(sink.closeMissing).not.toHaveBeenCalled();
  });
});
