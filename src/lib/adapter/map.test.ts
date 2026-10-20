import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAdapter } from './local';
import { LocalStore } from './localStore.data';
import type { SeedCompany } from '../../data/seed-companies';
import type { FetchLike } from '../ats/types';
import { DEFAULT_FILTERS } from '../filters';

const SEED: SeedCompany[] = [
  {
    slug: 'multicity',
    name: 'MultiCityCo',
    websiteUrl: 'https://multicity.test',
    careersUrl: 'https://multicity.test/careers',
    description: 'Roles in multiple cities.',
    fields: ['Technology'],
    companyType: 'Startup',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'multicity',
    // HQ in San Francisco — used as the fallback for remote roles.
    locations: [{ city: 'San Francisco', state: 'CA', country: 'USA', latitude: 37.7749, longitude: -122.4194 }],
  },
];

// Three roles: Seattle, New York, and a Remote one.
const fetchImpl: FetchLike = async () => {
  const job = (id: number, title: string, loc: string) => ({
    id,
    title,
    absolute_url: `https://x/jobs/${id}`,
    content: '&lt;p&gt;d&lt;/p&gt;',
    location: { name: loc },
  });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      jobs: [
        job(1, 'Summer 2027 Software Intern', 'Seattle, WA'),
        job(2, 'Summer 2027 Data Intern', 'New York, NY'),
        job(3, 'Summer 2027 Remote Intern', 'Remote'),
      ],
    }),
  };
};

describe('getMapCompanies — role-level coordinates', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = new LocalAdapter(new LocalStore(SEED));
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  });

  it('plots roles at their actual job city coordinates (Seattle, New York)', async () => {
    const markers = await adapter.getMapCompanies(DEFAULT_FILTERS);
    const byCity = Object.fromEntries(markers.map((m) => [m.city, m]));

    expect(byCity['Seattle']).toMatchObject({ latitude: 47.6062, longitude: -122.3321 });
    expect(byCity['New York']).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
  });

  it('falls back to the company HQ for the Remote role', async () => {
    const markers = await adapter.getMapCompanies(DEFAULT_FILTERS);
    // The remote role has no city; it should land on the SF HQ coordinate.
    const sf = markers.find((m) => m.latitude === 37.7749 && m.longitude === -122.4194);
    expect(sf).toBeDefined();
  });

  it('resolves a favicon logo for each marker from the website domain', async () => {
    const markers = await adapter.getMapCompanies(DEFAULT_FILTERS);
    expect(markers[0].logoUrl).toContain('favicons');
  });

  it('drops all markers when an active filter excludes every role', async () => {
    const markers = await adapter.getMapCompanies({ ...DEFAULT_FILTERS, seasons: ['Winter'] });
    expect(markers).toHaveLength(0);
  });
});
