import { describe, it, expect } from 'vitest';
import type { FetchLike } from '../types';
import { createTheMuseClient } from './themuse';
import { createRemotiveClient } from './remotive';

function singleResponse(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

describe('The Muse aggregator', () => {
  it('keeps relevant early-career roles with company + apply URL', async () => {
    const muse = {
      results: [
        {
          id: 1,
          name: 'Data Analyst Intern',
          contents: '<p>Analyze data.</p>',
          refs: { landing_page: 'https://example.com/jobs/1' },
          company: { name: 'Acme Data' },
          locations: [{ name: 'Seattle, WA' }],
          levels: [{ name: 'Internship' }],
          categories: [{ name: 'Data and Analytics' }],
          publication_date: '2026-09-01',
        },
        {
          id: 2,
          name: 'Barista',
          refs: { landing_page: 'https://example.com/jobs/2' },
          company: { name: 'Coffee Co' },
          categories: [{ name: 'Food Services' }],
          levels: [{ name: 'Entry Level' }],
        },
      ],
      page_count: 1,
    };
    const client = createTheMuseClient(singleResponse(muse));
    const out = await client.fetchEarlyCareer();
    // Only the relevant Data role is kept; the Barista (non-tech category) is dropped.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      companyName: 'Acme Data',
      title: 'Data Analyst Intern',
      applyUrl: 'https://example.com/jobs/1',
      city: 'Seattle',
      source: 'themuse',
    });
  });
});

describe('Remotive aggregator', () => {
  it('keeps early-career titles and drops senior roles', async () => {
    const remotive = {
      jobs: [
        { id: 10, title: 'Junior Data Analyst', company_name: 'RemoteCo', url: 'https://remotive.com/j/10' },
        { id: 11, title: 'Senior Analyst', company_name: 'RemoteCo', url: 'https://remotive.com/j/11' },
        { id: 12, title: 'Marketing Intern', company_name: 'Beta', url: 'https://remotive.com/j/12' },
        // Bare "Associate" (no intern/grad, no "Associate I") is now rejected.
        { id: 13, title: 'Marketing Associate', company_name: 'Beta', url: 'https://remotive.com/j/13' },
        // Full-time recruiter meta-role must be rejected even though it's "remote early career".
        { id: 14, title: 'Early Career Recruiter', company_name: 'Beta', url: 'https://remotive.com/j/14' },
      ],
    };
    const client = createRemotiveClient(singleResponse(remotive));
    const out = await client.fetchEarlyCareer();
    const titles = out.map((o) => o.title);
    expect(titles).toContain('Junior Data Analyst');
    expect(titles).toContain('Marketing Intern');
    expect(titles).not.toContain('Senior Analyst');
    expect(titles).not.toContain('Marketing Associate');
    expect(titles).not.toContain('Early Career Recruiter');
    expect(out.every((o) => o.workArrangement === 'Remote')).toBe(true);
  });
});
