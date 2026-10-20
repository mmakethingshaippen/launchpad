import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAdapter } from './local';
import { LocalStore } from './localStore.data';
import type { SeedCompany } from '../../data/seed-companies';
import type { FetchLike } from '../ats/types';
import { DEFAULT_FILTERS } from '../filters';

// A tiny two-company seed: one Greenhouse startup, one Lever established company.
const SEED: SeedCompany[] = [
  {
    slug: 'startupco',
    name: 'StartupCo',
    websiteUrl: 'https://startupco.test',
    careersUrl: 'https://startupco.test/careers',
    description: 'A startup.',
    fields: ['Technology'],
    companyType: 'Startup',
    startupStage: 'Seed',
    employeeCountRange: '11-50',
    foundingYear: 2022,
    degreeLevels: ['Undergraduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'startupco',
    locations: [{ city: 'Austin', state: 'TX', country: 'USA', latitude: 30.26, longitude: -97.74 }],
  },
  {
    slug: 'bigco',
    name: 'BigCo',
    websiteUrl: 'https://bigco.test',
    careersUrl: 'https://bigco.test/careers',
    description: 'Established.',
    fields: ['Finance'],
    companyType: 'Established Company',
    employeeCountRange: '501+',
    foundingYear: 1999,
    degreeLevels: ['Undergraduate', 'Graduate'],
    atsProvider: 'greenhouse',
    atsBoardToken: 'bigco',
    locations: [{ city: 'New York', state: 'NY', country: 'USA', latitude: 40.71, longitude: -74.0 }],
  },
];

function ghJob(id: number, title: string, remote = false) {
  return {
    id,
    title,
    absolute_url: `https://boards.greenhouse.io/x/jobs/${id}`,
    content: '&lt;p&gt;desc&lt;/p&gt;',
    location: { name: remote ? 'Remote' : 'Austin, TX, USA' },
  };
}

// StartupCo returns a remote summer intern; BigCo returns an onsite new-grad.
const fetchImpl: FetchLike = async (url) => {
  const payload = url.includes('/startupco/')
    ? { jobs: [ghJob(1, 'Summer 2027 Software Intern', true)] }
    : { jobs: [ghJob(2, 'New Grad Financial Analyst')] };
  return { ok: true, status: 200, json: async () => payload };
};

describe('LocalAdapter', () => {
  let adapter: LocalAdapter;

  beforeEach(async () => {
    adapter = new LocalAdapter(new LocalStore(SEED));
    // inject the fake fetch for the lazy sync
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
  });

  it('returns live-synced roles by default (opportunities view)', async () => {
    const res = await adapter.searchRoles(DEFAULT_FILTERS);
    expect(res.total).toBe(2);
    expect(res.items.map((r) => r.title).sort()).toEqual([
      'New Grad Financial Analyst',
      'Summer 2027 Software Intern',
    ]);
  });

  it('filters by season (Summer)', async () => {
    const res = await adapter.searchRoles({ ...DEFAULT_FILTERS, seasons: ['Summer'] });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].title).toContain('Summer');
  });

  it('filters startup-only', async () => {
    const res = await adapter.searchRoles({ ...DEFAULT_FILTERS, companyType: 'Startup' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].companyName).toBe('StartupCo');
  });

  it('filters remote-only', async () => {
    const res = await adapter.searchRoles({ ...DEFAULT_FILTERS, remoteOnly: true });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].workArrangement).toBe('Remote');
  });

  it('derives live stats from the store', async () => {
    const stats = await adapter.getStats();
    // StartupCo's remote intern falls back to its Austin HQ coords; BigCo's
    // analyst resolves to the Austin city-center — slightly different coords →
    // 2 distinct map buckets (cities).
    expect(stats).toEqual({ companies: 2, activeRoles: 2, startups: 1, cities: 2 });
  });

  it('getCompany returns the profile with its active roles', async () => {
    const company = await adapter.getCompany('startupco');
    expect(company?.name).toBe('StartupCo');
    expect(company?.activeRoleCount).toBe(1);
    expect(company?.roles).toHaveLength(1);
  });

  it('getRole returns a shareable detail view', async () => {
    const list = await adapter.searchRoles(DEFAULT_FILTERS);
    const slug = list.items[0].slug;
    const detail = await adapter.getRole(slug);
    expect(detail?.applyUrl).toMatch(/^https:\/\//);
    expect(detail?.description).toContain('<p>'); // decoded Greenhouse HTML
  });

  it('saves and lists saved roles via localStorage dedup', async () => {
    const list = await adapter.searchRoles(DEFAULT_FILTERS);
    const roleId = list.items[0].id;
    await adapter.save(roleId);
    await adapter.save(roleId); // dedup
    const saved = await adapter.listSaved();
    expect(saved).toHaveLength(1);
    expect(saved[0].role?.id).toBe(roleId);
  });
});

describe('LocalAdapter — zero-role companies are hidden (Req 3)', () => {
  // EmptyCo has an ATS token that returns no jobs → 0 active roles.
  const SEED_WITH_EMPTY: SeedCompany[] = [
    ...SEED,
    {
      slug: 'emptyco',
      name: 'EmptyCo',
      websiteUrl: 'https://emptyco.test',
      careersUrl: 'https://emptyco.test/careers',
      description: 'No open roles right now.',
      fields: ['Technology'],
      companyType: 'Established Company',
      employeeCountRange: '501+',
      degreeLevels: ['Undergraduate'],
      atsProvider: 'greenhouse',
      atsBoardToken: 'emptyco',
      locations: [{ city: 'Denver', state: 'CO', country: 'USA', latitude: 39.7392, longitude: -104.9903 }],
    },
  ];

  const emptyAwareFetch: FetchLike = async (url) => {
    if (url.includes('/emptyco/')) return { ok: true, status: 200, json: async () => ({ jobs: [] }) };
    const payload = url.includes('/startupco/')
      ? { jobs: [ghJob(1, 'Summer 2027 Software Intern', true)] }
      : { jobs: [ghJob(2, 'New Grad Financial Analyst')] };
    return { ok: true, status: 200, json: async () => payload };
  };

  it('never surfaces a company with 0 active roles in searchCompanies', async () => {
    const adapter = new LocalAdapter(new LocalStore(SEED_WITH_EMPTY));
    await adapter.ensureSynced(emptyAwareFetch as unknown as typeof fetch);
    const res = await adapter.searchCompanies(DEFAULT_FILTERS);
    const names = res.items.map((c) => c.name);
    expect(names).toContain('StartupCo');
    expect(names).toContain('BigCo');
    expect(names).not.toContain('EmptyCo'); // hidden — no active roles
    // But the company still exists in the backend (directly addressable).
    const profile = await adapter.getCompany('emptyco');
    expect(profile?.name).toBe('EmptyCo');
  });
});
