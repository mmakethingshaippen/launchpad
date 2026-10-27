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
    ).rejects.toThrow(/HTTP 404/);
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
    expect(client.isCompleteSnapshot?.()).toBe(true);
    expect(raw.map((posting) => posting.title)).toEqual(['Pharmacy Intern']);
    expect(client.toNormalized(raw[0])).toMatchObject({ city: 'Sterling Heights', state: 'MI' });
  });
});
