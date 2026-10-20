import { describe, it, expect, vi } from 'vitest';
import type { FetchLike } from '../types';
import { createUsaJobsClient } from './usajobs';

function singleResponse(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

const sample = {
  SearchResult: {
    SearchResultItems: [
      {
        MatchedObjectId: '123',
        MatchedObjectDescriptor: {
          PositionTitle: 'Student Trainee (Data Science)',
          PositionURI: 'https://www.usajobs.gov/job/123',
          ApplyURI: ['https://www.usajobs.gov/apply/123'],
          OrganizationName: 'Department of Commerce',
          PositionLocation: [
            { CityName: 'Washington', CountrySubDivisionCode: 'DC', CountryCode: 'United States' },
          ],
          UserArea: { Details: { JobSummary: 'A student role.' } },
          PublicationStartDate: '2026-09-01',
        },
      },
    ],
  },
};

describe('USAJOBS connector', () => {
  it('skips cleanly with no API key', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const client = createUsaJobsClient(singleResponse(sample), {});
    expect(client.enabled).toBe(false);
    const out = await client.fetchEarlyCareer();
    expect(out).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith('Skipping USAJOBS: USAJOBS_API_KEY not set');
    logSpy.mockRestore();
  });

  it('maps federal student postings when a key is present', async () => {
    const client = createUsaJobsClient(singleResponse(sample), {
      USAJOBS_API_KEY: 'test-key',
      USAJOBS_USER_AGENT: 'me@example.com',
    });
    expect(client.enabled).toBe(true);
    const out = await client.fetchEarlyCareer();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: 'usajobs',
      companyName: 'Department of Commerce',
      title: 'Student Trainee (Data Science)',
      applyUrl: 'https://www.usajobs.gov/apply/123',
      city: 'Washington',
      state: 'DC',
    });
  });

  it('sends the API key and user agent as headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      capturedHeaders = init?.headers;
      return { ok: true, status: 200, json: async () => sample };
    };
    const client = createUsaJobsClient(fetchImpl, {
      USAJOBS_API_KEY: 'secret-key',
      USAJOBS_USER_AGENT: 'me@example.com',
    });
    await client.fetchEarlyCareer();
    expect(capturedHeaders?.['Authorization-Key']).toBe('secret-key');
    expect(capturedHeaders?.['User-Agent']).toBe('me@example.com');
  });
});
