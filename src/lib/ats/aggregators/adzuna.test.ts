import { describe, it, expect, vi } from 'vitest';
import type { FetchLike } from '../types';
import { createAdzunaClient } from './adzuna';

function fakeFetch(payload: unknown): FetchLike {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

describe('Adzuna connector', () => {
  it('is a safe no-op when env keys are absent', async () => {
    const fetchSpy = vi.fn();
    const client = createAdzunaClient(fetchSpy as unknown as FetchLike, {});
    expect(client.enabled).toBe(false);
    const out = await client.fetchEarlyCareer();
    expect(out).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches and filters early-career roles (broad pass), dropping senior + bare-junior', async () => {
    const payload = {
      results: [
        { id: '1', title: 'Data Analyst Intern', redirect_url: 'https://adzuna/1', company: { display_name: 'Acme' }, location: { display_name: 'Seattle, WA' } },
        { id: '2', title: 'Senior Staff Engineer', redirect_url: 'https://adzuna/2', company: { display_name: 'Beta' }, location: { display_name: 'Austin, TX' } },
        // Bare "Junior Developer" is now rejected by the tightened title gate.
        { id: '3', title: 'Junior Developer', redirect_url: 'https://adzuna/3', company: { display_name: 'Gamma' }, location: { display_name: 'Remote' } },
      ],
    };
    const client = createAdzunaClient(fakeFetch(payload), {
      ADZUNA_APP_ID: 'id',
      ADZUNA_API_KEY: 'key',
    } as NodeJS.ProcessEnv);
    expect(client.enabled).toBe(true);

    const out = await client.fetchEarlyCareer();
    const titles = out.map((o) => o.title);
    expect(titles).toContain('Data Analyst Intern');
    expect(titles).not.toContain('Senior Staff Engineer');
    expect(titles).not.toContain('Junior Developer');
    // Deduped across the 6 passes by externalJobId → the intern appears once.
    expect(out.filter((o) => o.title === 'Data Analyst Intern')).toHaveLength(1);
    expect(out[0]).toMatchObject({ companyName: 'Acme', city: 'Seattle', state: 'WA', source: 'adzuna' });
  });

  it('runs targeted employer passes and stamps the canonical seeded company name', async () => {
    // Return a Google internship only for the Google (what_phrase=Google) pass.
    const fetchImpl: FetchLike = async (url) => {
      const isGoogle = url.includes('what_phrase=Google');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: isGoogle
            ? [
                {
                  id: 'g1',
                  title: 'Software Engineering Intern',
                  redirect_url: 'https://adzuna/g1',
                  company: { display_name: 'Google LLC' },
                  location: { display_name: 'Mountain View, CA' },
                },
              ]
            : [],
        }),
      };
    };
    const client = createAdzunaClient(fetchImpl, {
      ADZUNA_APP_ID: 'id',
      ADZUNA_API_KEY: 'key',
    } as NodeJS.ProcessEnv);
    const out = await client.fetchEarlyCareer();
    const google = out.find((o) => o.externalJobId === 'adzuna-g1');
    expect(google).toBeDefined();
    // "Google LLC" from the feed is rewritten to the canonical seeded "Google".
    expect(google!.companyName).toBe('Google');
    expect(google!.companyWebsite).toBe('https://www.google.com');
  });
});
