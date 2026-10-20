import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../types';
import { createAmazonClient } from './amazon';

function pageFetch(pages: Record<number, unknown>): FetchLike {
  return async (url) => {
    const m = /offset=(\d+)/.exec(url);
    const offset = m ? Number(m[1]) : 0;
    const page = offset / 100;
    return { ok: true, status: 200, json: async () => pages[page] ?? { jobs: [] } };
  };
}

describe('Amazon public JSON connector', () => {
  it('keeps early-career roles, stamps canonical "Amazon", builds absolute apply URLs', async () => {
    const payload = {
      hits: 3,
      jobs: [
        {
          id: '101',
          title: 'Software Dev Engineer Intern',
          company_name: 'Amazon.com Services LLC',
          city: 'Seattle',
          state: 'Washington',
          country_code: 'USA',
          job_path: '/en/jobs/101/sde-intern',
          is_intern: true,
        },
        {
          // Senior role returned by base_query=intern must be dropped.
          id: '102',
          title: 'Senior Software Engineer',
          company_name: 'Amazon',
          job_path: '/en/jobs/102/senior',
        },
        {
          // Generic full-time "Engineer I" must be dropped by the tightened gate.
          id: '103',
          title: 'Software Engineer I',
          company_name: 'Amazon',
          job_path: '/en/jobs/103/swe1',
        },
      ],
    };
    const client = createAmazonClient(pageFetch({ 0: payload }));
    const out = await client.fetchEarlyCareer();

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'amazon',
      companyName: 'Amazon',
      title: 'Software Dev Engineer Intern',
      applyUrl: 'https://www.amazon.jobs/en/jobs/101/sde-intern',
      city: 'Seattle',
      state: 'Washington',
    });
  });

  it('preserves international physical locations and never defaults them to Remote (Req 2)', async () => {
    const payload = {
      jobs: [
        {
          id: '201',
          title: 'Operations Intern',
          company_name: 'Amazon Spain Fulfillment, S.L.U.',
          city: 'San Fernando De Henares',
          state: '',
          country_code: 'ESP',
          location: 'ES, San Fernando De Henares',
          job_path: '/en/jobs/201/ops-intern',
          is_intern: true,
        },
        {
          id: '202',
          title: 'Finance Intern',
          company_name: 'Amazon',
          city: 'Betim',
          state: 'MG',
          country_code: 'BRA',
          location: 'BR, MG, Betim',
          job_path: '/en/jobs/202/fin-intern',
          is_intern: true,
        },
      ],
    };
    const client = createAmazonClient(pageFetch({ 0: payload }));
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(2);
    const madrid = out.find((o) => o.externalJobId === 'amazon-201')!;
    expect(madrid.city).toBe('San Fernando De Henares');
    expect(madrid.country).toBe('ESP');
    expect(madrid.workArrangement).toBeUndefined(); // NOT forced to Remote
    const betim = out.find((o) => o.externalJobId === 'amazon-202')!;
    expect(betim.city).toBe('Betim');
    expect(betim.state).toBe('MG');
    expect(betim.workArrangement).toBeUndefined();
  });

  it('pages through results and dedupes by id', async () => {
    const mkJobs = (ids: number[]) => ({
      jobs: ids.map((i) => ({
        id: String(i),
        title: 'Finance Intern',
        company_name: 'Amazon',
        job_path: `/en/jobs/${i}/finance-intern`,
      })),
    });
    // Page 0 full (100 unique), page 1 partial (stops paging).
    const page0 = mkJobs(Array.from({ length: 100 }, (_, i) => i));
    const page1 = mkJobs([100, 101]);
    const client = createAmazonClient(pageFetch({ 0: page0, 1: page1 }));
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(102);
    expect(new Set(out.map((o) => o.externalJobId)).size).toBe(102);
  });
});
