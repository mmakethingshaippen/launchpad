import { describe, it, expect, beforeEach } from 'vitest';
import { LocalAdapter } from './local';
import { LocalStore } from './localStore.data';
import type { SeedCompany } from '../../data/seed-companies';
import type { FetchLike } from '../ats/types';
import type { Role } from './types';
import { DEFAULT_FILTERS } from '../filters';
import { isAwaitingVerification } from '../freshness';

const company = (slug: string, name: string, city: string, latitude: number, longitude: number): SeedCompany => ({
  slug, name,
  websiteUrl: `https://${slug}.test`, careersUrl: `https://${slug}.test/careers`, description: name,
  fields: ['Technology'], companyType: 'Established Company', employeeCountRange: '501+', foundingYear: 2000,
  degreeLevels: ['Undergraduate'], atsProvider: 'greenhouse', atsBoardToken: slug,
  locations: [{ city, state: 'TX', country: 'USA', latitude, longitude }],
});
const SEED: SeedCompany[] = [
  company('freshco', 'FreshCo', 'Austin', 30.26, -97.74),
  company('staleco', 'StaleCo', 'Dallas', 32.78, -96.8),
];
const job = (id: number, title: string, city: string) => ({
  id, title, absolute_url: `https://boards.greenhouse.io/x/jobs/${id}`,
  content: '&lt;p&gt;desc&lt;/p&gt;', location: { name: `${city}, TX, USA` },
});
const fetchImpl: FetchLike = async (url) => {
  const jobs = url.includes('/freshco/')
    ? [job(1, 'Summer 2027 Software Intern', 'Austin'), job(2, 'Summer 2027 Data Intern', 'Austin')]
    : [job(3, 'New Grad Financial Analyst', 'Dallas')];
  return { ok: true, status: 200, json: async () => ({ jobs }) };
};

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

function rolesOf(adapter: LocalAdapter): Role[] {
  return [...(adapter.store as unknown as { roles: Map<string, Role> }).roles.values()];
}
function byTitle(adapter: LocalAdapter, title: string): Role {
  const r = rolesOf(adapter).find((x) => x.title === title);
  if (!r) throw new Error(`no role ${title}`);
  return r;
}
async function visibleIds(adapter: LocalAdapter) {
  const search = await adapter.searchRoles(DEFAULT_FILTERS);
  const map = await adapter.getMapData(DEFAULT_FILTERS);
  const mapIds = new Set([...map.markers.flatMap((m) => m.roles.map((r) => r.id)), ...map.unmappedRoles.map((r) => r.id)]);
  return { search, searchIds: new Set(search.items.map((r) => r.id)), mapIds };
}

describe('seven-day freshness in public listings (LocalAdapter)', () => {
  let adapter: LocalAdapter;
  beforeEach(async () => {
    adapter = new LocalAdapter(new LocalStore(SEED));
    await adapter.ensureSynced(fetchImpl as unknown as typeof fetch);
    byTitle(adapter, 'Summer 2027 Software Intern').lastVerifiedAt = daysAgo(1);
    byTitle(adapter, 'Summer 2027 Data Intern').lastVerifiedAt = daysAgo(10);
    byTitle(adapter, 'New Grad Financial Analyst').lastVerifiedAt = null;
  });

  it('shows only recently verified jobs in Browse, map markers, counts, company pages and Home', async () => {
    const { search, searchIds, mapIds } = await visibleIds(adapter);
    const fresh = byTitle(adapter, 'Summer 2027 Software Intern').id;
    expect([...searchIds]).toEqual([fresh]);
    expect(search.total).toBe(1);
    expect([...mapIds]).toEqual([fresh]);

    const stats = await adapter.getStats();
    expect(stats.activeRoles).toBe(1);
    expect(stats.companies).toBe(1); // StaleCo has no visible jobs, so it is not counted
    expect(stats.cities).toBe(1);

    expect((await adapter.getCompany('freshco'))!.roles.map((r) => r.id)).toEqual([fresh]);
    expect((await adapter.getCompany('staleco'))!.roles).toEqual([]);
    const companies = await adapter.searchCompanies(DEFAULT_FILTERS);
    expect(companies.items.map((c) => [c.slug, c.activeRoleCount])).toEqual([['freshco', 1]]);

    const featured = await adapter.getFeatured();
    const featuredIds = [
      ...featured.recentlyVerified, ...featured.byUpcomingTerm, ...featured.approachingDeadline, ...featured.startupOpportunities,
    ].map((r) => r.id);
    expect(featuredIds.every((id) => id === fresh)).toBe(true);
  });

  it('applies the same visible set under filters', async () => {
    const res = await adapter.searchRoles({ ...DEFAULT_FILTERS, seasons: ['Summer'] });
    expect(res.items.map((r) => r.title)).toEqual(['Summer 2027 Software Intern']);
  });

  it('hides without closing or re-dating, and keeps the direct link answerable', async () => {
    const stale = byTitle(adapter, 'Summer 2027 Data Intern');
    const before = stale.lastVerifiedAt;
    await adapter.searchRoles(DEFAULT_FILTERS);
    await adapter.getStats();
    expect(stale.listingStatus).toBe('Active');
    expect(stale.lastVerifiedAt).toBe(before);
    const detail = await adapter.getRole(stale.slug);
    expect(detail).not.toBeNull();
    expect(isAwaitingVerification(detail!)).toBe(true);
  });

  it('restores visibility everywhere once a verification succeeds', async () => {
    byTitle(adapter, 'Summer 2027 Data Intern').lastVerifiedAt = new Date().toISOString();
    byTitle(adapter, 'New Grad Financial Analyst').lastVerifiedAt = new Date().toISOString();
    const { search, searchIds, mapIds } = await visibleIds(adapter);
    expect(search.total).toBe(3);
    expect(mapIds).toEqual(searchIds);
    expect((await adapter.getStats()).activeRoles).toBe(3);
    expect((await adapter.getStats()).companies).toBe(2);
  });

  it('still respects the existing deadline and status rules for fresh jobs', async () => {
    const fresh = byTitle(adapter, 'Summer 2027 Software Intern');
    fresh.applicationDeadline = '2020-01-01';
    expect((await adapter.searchRoles(DEFAULT_FILTERS)).total).toBe(0);
    fresh.applicationDeadline = null;
    fresh.listingStatus = 'Closed';
    expect((await adapter.searchRoles(DEFAULT_FILTERS)).total).toBe(0);
  });
});