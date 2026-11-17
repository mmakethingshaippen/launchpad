import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../types';
import { createWorkdayClient, parseWorkdayToken } from './workday';

const FIXTURE = {
  total: 2,
  jobPostings: [
    {
      title: 'Software Engineering Intern - 2027',
      externalPath: '/job/Santa-Clara-CA/SWE-Intern_JR12345',
      locationsText: 'Santa Clara, CA',
      postedOn: 'Posted 3 Days Ago',
      bulletFields: ['JR12345'],
    },
    {
      title: 'Remote Data Science Intern',
      externalPath: '/job/Remote/Data-Intern_JR67890',
      locationsText: 'Remote - USA',
      bulletFields: ['JR67890'],
    },
  ],
};

function fakeFetch(payload: unknown, status = 200): FetchLike {
  // Return the fixture on the first page, then an empty page to end pagination.
  let call = 0;
  return async () => {
    call += 1;
    const body = call === 1 ? payload : { total: 0, jobPostings: [] };
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

describe('parseWorkdayToken', () => {
  it('parses host|tenant|site', () => {
    expect(parseWorkdayToken('nvidia.wd5.myworkdayjobs.com|nvidia|Site')).toEqual({
      host: 'nvidia.wd5.myworkdayjobs.com',
      tenant: 'nvidia',
      site: 'Site',
    });
  });
  it('accepts a myworkdaysite.com board', () => {
    expect(parseWorkdayToken('wd1.myworkdaysite.com|fmr|FidelityCareers')).toEqual({
      host: 'wd1.myworkdaysite.com',
      tenant: 'fmr',
      site: 'FidelityCareers',
    });
  });
  it('returns null for malformed tokens', () => {
    expect(parseWorkdayToken('nvidia')).toBeNull();
    expect(parseWorkdayToken('a||c')).toBeNull();
  });
});

describe('Workday provider', () => {
  it('builds canonical apply URLs and maps location', async () => {
    const client = createWorkdayClient(fakeFetch(FIXTURE));
    const raw = await client.fetchPostings('nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite');
    expect(raw).toHaveLength(2);

    const first = client.toNormalized(raw[0]);
    expect(first).toMatchObject({
      externalJobId: 'JR12345',
      title: 'Software Engineering Intern - 2027',
      city: 'Santa Clara',
      state: 'CA',
      applyUrl:
        'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Santa-Clara-CA/SWE-Intern_JR12345',
    });

    const second = client.toNormalized(raw[1]);
    expect(second?.workArrangement).toBe('Remote');

    const fidelity = createWorkdayClient(fakeFetch(FIXTURE));
    const fidelityRaw = await fidelity.fetchPostings('wd1.myworkdaysite.com|fmr|FidelityCareers');
    expect(fidelity.toNormalized(fidelityRaw[0])?.applyUrl).toBe(
      'https://wd1.myworkdaysite.com/recruiting/fmr/FidelityCareers/job/Santa-Clara-CA/SWE-Intern_JR12345',
    );
  });

  it('throws on a first-page non-200', async () => {
    const client = createWorkdayClient(fakeFetch({}, 404));
    await expect(
      client.fetchPostings('x.wd5.myworkdayjobs.com|x|Site'),
    ).rejects.toThrow(/incorrect-endpoint: http-404 on the first page/);
  });

  it('downloads the internship category when the full board cannot finish', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { appliedFacets?: Record<string, string[]> };
      const narrowed = Object.keys(body.appliedFacets ?? {}).length > 0;
      return {
        ok: true,
        status: 200,
        json: async () => narrowed
          ? {
              total: 1,
              jobPostings: [{
                title: 'Pharmacy Intern',
                externalPath: '/job/Sterling-Heights/Pharmacy-Intern_P1',
                locationsText: 'MI - Sterling Heights',
                bulletFields: ['P1'],
              }],
            }
          : {
              total: 19000,
              jobPostings: [{
                title: 'Retail Associate',
                externalPath: '/job/full_R1',
                locationsText: 'TX - Austin',
                bulletFields: ['R1'],
              }],
              facets: [{
                facetParameter: 'jobFamilyGroup',
                values: [
                  { descriptor: 'Internships and Devlpmt Pgms', id: 'intern-facet', count: 4050 },
                  { descriptor: 'Stores', id: 'stores', count: 15000 },
                ],
              }],
            },
      };
    };
    const client = createWorkdayClient(fetchImpl);
    const raw = await client.fetchPostings('cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers');
    expect(client.isCompleteSnapshot?.()).toBe(false);
    expect(raw.map((posting) => posting.title)).toEqual(['Pharmacy Intern']);
    expect(client.toNormalized(raw[0])).toMatchObject({ city: 'Sterling Heights', state: 'MI' });
  });

  it('retries a temporary 502 and keeps the jobs', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => FIXTURE };
    };
    const client = createWorkdayClient(fetchImpl);
    const raw = await client.fetchPostings('cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers');
    expect(raw).toHaveLength(2);
    expect(calls).toBeGreaterThan(1);
  });

  it('keeps reading every later page when one page stays down', async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { offset?: number };
      const offset = body.offset ?? 0;
      if (offset === 20) return { ok: false, status: 502, json: async () => ({}) };
      if (offset === 0) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total: 41,
            jobPostings: Array.from({ length: 20 }, (_, i) => ({
              title: `Intern ${i}`,
              externalPath: `/job/a_${i}`,
              locationsText: 'Austin, TX',
              bulletFields: [`A${i}`],
            })),
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          total: 41,
          jobPostings: [{
            title: 'Data Intern',
            externalPath: '/job/b_B1',
            locationsText: 'Seattle, WA',
            bulletFields: ['B1'],
          }],
        }),
      };
    };
    const client = createWorkdayClient(fetchImpl);
    const raw = await client.fetchPostings('x.wd5.myworkdayjobs.com|x|Site');
    expect(raw[0]?.title).toBe('Intern 0');
    expect(raw.at(-1)?.title).toBe('Data Intern');
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });
});

describe('Workday paging totals (production tenants, Nov 2026)', () => {
  const TOKEN = 'nvidia.wd5.myworkdayjobs.com|nvidia|NVIDIAExternalCareerSite';
  const posting = (i: number) => ({ title: `Software Engineering Intern ${i}`, externalPath: `/job/US-CA/Intern_JR${i}`, locationsText: 'Santa Clara, CA', bulletFields: [`JR${i}`] });
  /** Serves `unique` postings; later offsets repeat earlier ones, like Workday past its 2000-job window. */
  function board(opts: { unique: number; firstTotal: number; laterTotal: number; facets?: unknown[]; facetPostings?: number }): FetchLike {
    return (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as { offset: number; appliedFacets: Record<string, string[]> };
      const narrowed = Object.keys(body.appliedFacets ?? {}).length > 0;
      const size = narrowed ? opts.facetPostings ?? 0 : opts.unique;
      const repeat = !narrowed && opts.unique >= 2000;
      const start = repeat ? body.offset % size : body.offset;
      const items = Array.from({ length: 20 }, (_, k) => start + k).filter((i) => repeat || i < size).map(posting);
      const total = body.offset === 0 ? (narrowed ? size : opts.firstTotal) : opts.laterTotal;
      return { ok: true, status: 200, json: async () => ({ total, jobPostings: items, facets: body.offset === 0 ? opts.facets ?? [] : [] }) };
    }) as unknown as FetchLike;
  }

  it('keeps reading when later pages report total: 0, and finishes the board', async () => {
    const client = createWorkdayClient(board({ unique: 45, firstTotal: 45, laterTotal: 0 }));
    expect(await client.fetchPostings(TOKEN)).toHaveLength(45);
    expect(client.isCompleteSnapshot?.()).toBe(true);
  });

  it('treats a total of 2000 as a cap: stops on repeated jobs and never reports the board complete', async () => {
    const inner = board({ unique: 2000, firstTotal: 2000, laterTotal: 0 });
    let requests = 0;
    const client = createWorkdayClient((async (url: string, init?: { body?: string }) => { requests += 1; return inner(url, init as never); }) as unknown as FetchLike);
    const jobs = await client.fetchPostings(TOKEN);
    expect(jobs).toHaveLength(2000);
    // 100 pages of new jobs plus the first repeated page; not 250 pages of repeats.
    expect(requests).toBe(101);
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('narrows a capped board to its internship facet, not to a facet that merely starts with "Intern"', async () => {
    const facets = [{ facetParameter: 'jobFamilyGroup', values: [
      { descriptor: 'Internal Audit', id: 'audit', count: 23 },
      { descriptor: 'Intern (Paid)', id: 'paid-intern', count: 15 },
    ] }];
    const requested: Array<Record<string, string[]>> = [];
    const inner = board({ unique: 2000, firstTotal: 2000, laterTotal: 0, facets, facetPostings: 15 });
    const client = createWorkdayClient((async (url: string, init?: { body?: string }) => {
      requested.push(JSON.parse(init?.body ?? '{}').appliedFacets);
      return inner(url, init as never);
    }) as unknown as FetchLike);
    expect(await client.fetchPostings(TOKEN)).toHaveLength(15);
    expect(requested.some((f) => f.jobFamilyGroup?.[0] === 'paid-intern')).toBe(true);
    expect(requested.some((f) => f.jobFamilyGroup?.[0] === 'audit')).toBe(false);
    expect(client.isCompleteSnapshot?.()).toBe(false); // a filtered list never closes absent jobs
  });
});

describe('Workday incomplete-download recovery', () => {
  const token = 'micron.wd1.myworkdayjobs.com|micron|External';
  const posting = (id: number) => ({
    title: `Engineering Intern ${id}`, externalPath: `/job/Boise/Intern_JR${id}`, bulletFields: [`JR${id}`],
  });
  const page = (start: number, total = 60) => ({
    total, jobPostings: Array.from({ length: 20 }, (_, i) => posting(start + i)),
  });

  it('stops a challenged first page after one request, with explicit blocked coverage', async () => {
    let calls = 0;
    const client = createWorkdayClient(async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'cf-mitigated': 'challenge' } });
    });
    await expect(client.fetchPostings(token)).rejects.toThrow(/access-challenge/);
    expect(calls).toBe(1);
    expect(client.getFetchCoverage?.()).toMatchObject({ status: 'blocked', host: 'micron.wd1.myworkdayjobs.com' });
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('saves downloaded jobs and stops all paging/recovery requests after a late challenge', async () => {
    const offsets: number[] = [];
    const client = createWorkdayClient(async (_url, init) => {
      const { offset } = JSON.parse(init?.body ?? '{}');
      offsets.push(offset);
      if (offset === 0) return new Response(JSON.stringify(page(0)), { headers: { 'content-type': 'application/json' } });
      return new Response('', { status: 429, headers: { 'cf-mitigated': 'challenge' } });
    });
    expect(await client.fetchPostings(token)).toHaveLength(20);
    expect(offsets).toEqual([0, 20]);
    expect(client.getFetchCoverage?.()).toMatchObject({ status: 'blocked' });
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });

  it('keeps earlier and later pages when an intermediate page has a persistent network error', async () => {
    const client = createWorkdayClient(async (_url, init) => {
      const { offset } = JSON.parse(init?.body ?? '{}');
      if (offset === 20) throw new TypeError('connection reset');
      return new Response(JSON.stringify(page(offset)), { headers: { 'content-type': 'application/json' } });
    });
    const raw = await client.fetchPostings(token);
    expect(raw).toHaveLength(40);
    expect(raw.at(-1)?.bulletFields).toEqual(['JR59']);
    expect(client.getFetchCoverage?.()).toMatchObject({ status: 'partial', reason: '1 page(s) unread' });
    expect(client.isCompleteSnapshot?.()).toBe(false);
  });
});
