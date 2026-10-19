import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAdapter } from './local';
import { LocalStore } from './localStore.data';
import type { SeedCompany } from '../../data/seed-companies';
import type { FetchLike } from '../ats/types';
import { DEFAULT_FILTERS } from '../filters';

const SEED: SeedCompany[] = [
  {
    slug: 'placed',
    name: 'PlacedCo',
    websiteUrl: 'https://placed.test',
    careersUrl: 'https://placed.test/careers',
    description: 'Has coordinates.',
    fields: ['Technology'],
    companyType: 'Startup',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'placed',
    locations: [{ city: 'Austin', state: 'TX', country: 'USA', latitude: 30.26, longitude: -97.74 }],
  },
  {
    slug: 'remoteco',
    name: 'RemoteCo',
    websiteUrl: 'https://remote.test',
    careersUrl: 'https://remote.test/careers',
    description: 'Remote only.',
    fields: ['Finance'],
    companyType: 'Established Company',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'remoteco',
    // Remote "location" with no real coordinates — must NOT be mapped (Req 11.5).
    locations: [{ city: 'Remote', country: 'USA', latitude: 0, longitude: 0 }],
  },
];

const fetchImpl: FetchLike = async (url) => {
  const job = (id: number, title: string, remote: boolean) => ({
    id,
    title,
    absolute_url: `https://x/jobs/${id}`,
    content: '&lt;p&gt;d&lt;/p&gt;',
    location: { name: remote ? 'Remote' : 'Austin, TX, USA' },
  });
  const payload = url.includes('/placed/')
    ? { jobs: [job(1, 'Summer 2027 Intern', false)] }
    : { jobs: [job(2, 'New Grad Analyst', true)] };
  return { ok: true, status: 200, json: async () => payload };
};

describe('getMapCompanies', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = new LocalAdapter(new LocalStore(SEED));
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  });

  it('includes only companies with a real geocoded location (excludes Remote)', async () => {
    const markers = await adapter.getMapCompanies(DEFAULT_FILTERS);
    expect(markers.map((m) => m.name)).toEqual(['PlacedCo']);
    expect(markers[0]).toMatchObject({ latitude: 30.26, longitude: -97.74 });
  });

  it('keeps a placed company when its season matches the filter', async () => {
    const markers = await adapter.getMapCompanies({ ...DEFAULT_FILTERS, seasons: ['Summer'] });
    expect(markers).toHaveLength(1);
    expect(markers[0].name).toBe('PlacedCo');
  });

  it('drops a placed company when an active filter excludes all its roles', async () => {
    const markers = await adapter.getMapCompanies({ ...DEFAULT_FILTERS, seasons: ['Winter'] });
    expect(markers).toHaveLength(0);
  });
});
