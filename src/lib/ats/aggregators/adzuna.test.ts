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

  it('fetches and filters early-career roles when keys are present', async () => {
    const payload = {
      results: [
        { id: '1', title: 'Data Analyst Intern', redirect_url: 'https://adzuna/1', company: { display_name: 'Acme' }, location: { display_name: 'Seattle, WA' } },
        { id: '2', title: 'Senior Staff Engineer', redirect_url: 'https://adzuna/2', company: { display_name: 'Beta' }, location: { display_name: 'Austin, TX' } },
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
    expect(titles).toContain('Junior Developer');
    expect(titles).not.toContain('Senior Staff Engineer');
    expect(out[0]).toMatchObject({ companyName: 'Acme', city: 'Seattle', state: 'WA', source: 'adzuna' });
  });
});
