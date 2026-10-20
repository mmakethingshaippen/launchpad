import { describe, it, expect } from 'vitest';
import { groupRolesIntoMarkers, type RoleMarkerInput } from './mapMarkers';

function input(partial: Partial<RoleMarkerInput>): RoleMarkerInput {
  return {
    companyId: 'c1',
    slug: 'acme',
    name: 'Acme',
    companyType: 'Startup',
    websiteUrl: 'https://acme.com',
    logoUrl: null,
    latitude: 47.6062,
    longitude: -122.3321,
    city: 'Seattle',
    state: 'WA',
    country: 'USA',
    ...partial,
  };
}

describe('groupRolesIntoMarkers', () => {
  it('creates one marker per distinct (company, city) and counts roles there', () => {
    const markers = groupRolesIntoMarkers([
      input({ city: 'Seattle', latitude: 47.6062, longitude: -122.3321 }),
      input({ city: 'Seattle', latitude: 47.6062, longitude: -122.3321 }),
      input({ city: 'New York', latitude: 40.7128, longitude: -74.006 }),
    ]);
    expect(markers).toHaveLength(2);
    const seattle = markers.find((m) => m.city === 'Seattle')!;
    const ny = markers.find((m) => m.city === 'New York')!;
    expect(seattle.activeRoleCount).toBe(2);
    expect(ny.activeRoleCount).toBe(1);
  });

  it('separates the same city across different companies', () => {
    const markers = groupRolesIntoMarkers([
      input({ companyId: 'c1', slug: 'acme' }),
      input({ companyId: 'c2', slug: 'beta' }),
    ]);
    expect(markers).toHaveLength(2);
  });

  it('resolves a favicon logo from the website when no logo_url', () => {
    const [m] = groupRolesIntoMarkers([input({ logoUrl: null, websiteUrl: 'https://acme.com' })]);
    expect(m.logoUrl).toContain('favicons');
  });

  it('drops markers without coordinates', () => {
    const markers = groupRolesIntoMarkers([
      input({ latitude: null as unknown as number, longitude: null as unknown as number }),
    ]);
    expect(markers).toHaveLength(0);
  });
});
