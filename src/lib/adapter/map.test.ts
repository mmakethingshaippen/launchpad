import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAdapter } from './local';
import { LocalStore } from './localStore.data';
import type { SeedCompany } from '../../data/seed-companies';
import type { FetchLike } from '../ats/types';
import { DEFAULT_FILTERS } from '../filters';

// Zipline: HQ in South San Francisco, with roles in SSF, Austin, and DFW.
const SEED: SeedCompany[] = [
  {
    slug: 'zipline',
    name: 'Zipline',
    websiteUrl: 'https://flyzipline.com',
    careersUrl: 'https://flyzipline.com/careers',
    description: 'Autonomous delivery by drone.',
    fields: ['Engineering'],
    companyType: 'Startup',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'flyzipline',
    locations: [{ city: 'South San Francisco', state: 'CA', country: 'USA', latitude: 37.6547, longitude: -122.4077 }],
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    websiteUrl: 'https://stripe.com',
    careersUrl: 'https://stripe.com/jobs',
    description: 'Payments.',
    fields: ['Technology'],
    companyType: 'Established Company',
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'stripe',
    locations: [{ city: 'San Francisco', state: 'CA', country: 'USA', latitude: 37.7749, longitude: -122.4194 }],
  },
];

// Greenhouse jobs with distinct cities per company.
const fetchImpl: FetchLike = async (url) => {
  const mk = (id: number, title: string, loc: string) => ({
    id,
    title,
    absolute_url: `https://x/jobs/${id}`,
    content: '&lt;p&gt;d&lt;/p&gt;',
    location: { name: loc },
  });
  const jobs = url.includes('/flyzipline/')
    ? [
        mk(1, 'Summer 2027 Robotics Intern', 'South San Francisco, California'),
        mk(2, 'Summer 2027 Operations Intern', 'Austin, Texas'),
        mk(3, 'Summer 2027 Logistics Intern', 'Dallas-Fort Worth, Texas'),
      ]
    : [mk(10, 'Summer 2027 Software Intern', 'San Francisco, California')];
  return { ok: true, status: 200, json: async () => ({ jobs }) };
};

describe('getMapMarkers — role-level geographic plotting', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = new LocalAdapter(new LocalStore(SEED));
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  });

  it('plots Zipline roles in 3 distinct markers (CA, Austin TX, DFW TX) with accurate counts', async () => {
    const markers = await adapter.getMapMarkers(DEFAULT_FILTERS);

    // Filter to markers that contain a Zipline role.
    const ziplineMarkers = markers.filter((m) => m.roles.some((r) => r.companyName === 'Zipline'));
    expect(ziplineMarkers).toHaveLength(3);

    const ssf = ziplineMarkers.find((m) => Math.abs(m.latitude - 37.6547) < 0.05)!;
    const austin = ziplineMarkers.find((m) => Math.abs(m.latitude - 30.2672) < 0.05)!;
    const dfw = ziplineMarkers.find((m) => Math.abs(m.latitude - 32.7673) < 0.05)!;

    expect(ssf).toBeDefined();
    expect(austin).toBeDefined();
    expect(dfw).toBeDefined();

    // Each Zipline city has exactly one Zipline role.
    expect(ssf.roles.filter((r) => r.companyName === 'Zipline')).toHaveLength(1);
    expect(austin.roles.filter((r) => r.companyName === 'Zipline')).toHaveLength(1);
    expect(dfw.roles.filter((r) => r.companyName === 'Zipline')).toHaveLength(1);

    // Austin marker is in Texas, not plotted at the SSF HQ.
    expect(austin.label).toMatch(/Austin, TX/);
    expect(dfw.label).toMatch(/Dallas-Fort Worth, TX/);
  });

  it('groups roles from different companies that share a city', async () => {
    const markers = await adapter.getMapMarkers(DEFAULT_FILTERS);
    // SSF (Zipline) and SF (Stripe) are different coordinates → separate pins.
    const sf = markers.find((m) => Math.abs(m.latitude - 37.7749) < 0.02)!;
    expect(sf.roles.some((r) => r.companyName === 'Stripe')).toBe(true);
  });

  it('respects the season filter', async () => {
    const winter = await adapter.getMapMarkers({ ...DEFAULT_FILTERS, seasons: ['Winter'] });
    expect(winter).toHaveLength(0); // all seeded roles are Summer
  });
});
