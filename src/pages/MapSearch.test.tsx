import { describe, it, expect } from 'vitest';
import { filterMarkersByCompany, companyNamesFromMarkers, companyOptionsFromMarkers, uniqueRoleCount } from './MapPage';
import type { MapMarker, MapMarkerRole } from '../lib/adapter';

function markerRole(company: string, id: string): MapMarkerRole {
  return {
    id,
    slug: id,
    title: 'Software Engineering Intern',
    companyName: company,
    companySlug: company.toLowerCase(),
    companyLogoUrl: null,
    companyWebsiteUrl: null,
    seasons: ['Summer'],
    cohortYear: 2027,
  };
}

function marker(id: string, lat: number, lng: number, roles: MapMarkerRole[]): MapMarker {
  const companies = new Set(roles.map((r) => r.companyName));
  return {
    id,
    label: id,
    city: id,
    state: null,
    latitude: lat,
    longitude: lng,
    roleCount: roles.length,
    companyCount: companies.size,
    roles,
  };
}

const MARKERS: MapMarker[] = [
  marker('Mountain View', 37.38, -122.08, [
    markerRole('Waymo', 'w1'),
    markerRole('Google', 'g1'),
  ]),
  marker('San Francisco', 37.77, -122.41, [markerRole('Stripe', 's1')]),
  marker('Austin', 30.26, -97.74, [markerRole('Waymo', 'w2'), markerRole('Tesla', 't1')]),
];

describe('companyNamesFromMarkers', () => {
  it('returns the sorted distinct company names across all markers', () => {
    expect(companyNamesFromMarkers(MARKERS)).toEqual(['Google', 'Stripe', 'Tesla', 'Waymo']);
  });
});

describe('filterMarkersByCompany (Req 3 — map company search)', () => {
  it('counts a multi-city role once in company options and totals', () => {
    const role = markerRole('Anthropic', 'shared');
    const markers = [marker('SF', 37.77, -122.41, [role]), marker('NY', 40.71, -74, [role])];
    expect(uniqueRoleCount(markers)).toBe(1);
    expect(companyOptionsFromMarkers(markers)).toMatchObject([{ name: 'Anthropic', roleCount: 1, cityCount: 2 }]);
  });

  it('does not include unrelated substring company matches after selecting a company', () => {
    const markers = [marker('SF', 37.77, -122.41, [markerRole('Meta', 'a'), markerRole('Metabolic', 'b')])];
    expect(filterMarkersByCompany(markers, 'Meta')[0].roles.map(role => role.id)).toEqual(['a']);
  });

  it('keeps companies without coordinates in the selector', () => {
    expect(companyOptionsFromMarkers([], [markerRole('Amazon', 'a')]))
      .toMatchObject([{ name: 'Amazon', roleCount: 1, cityCount: 0 }]);
  });

  it('keeps different company records distinct even when their normalized names match', () => {
    const roles = [{ ...markerRole('Example', 'a'), companySlug: 'example-1' },
      { ...markerRole('Example Inc', 'b'), companySlug: 'example-2' }];
    const markers = [marker('SF', 37.77, -122.41, roles)];
    expect(companyOptionsFromMarkers(markers)).toHaveLength(2);
    expect(filterMarkersByCompany(markers, 'Example', true, 'example-1')[0].roles.map(role => role.id)).toEqual(['a']);
  });

  it('uses the selected company location when several cities share an approximate coordinate', () => {
    const roles = [{ ...markerRole('Bechtel', 'a'), locationLabel: 'Gunnison, CO', locationCity: 'Gunnison', locationState: 'CO' },
      { ...markerRole('Other', 'b'), locationLabel: 'Westminster, CO', locationCity: 'Westminster' }];
    const markers = [marker('Westminster, CO', 39.05, -105.31, roles)];
    expect(filterMarkersByCompany(markers, 'Bechtel')[0]).toMatchObject({ label: 'Gunnison, CO', city: 'Gunnison' });
  });
  it('keeps only markers/roles for the selected company and recomputes counts', () => {
    const waymo = filterMarkersByCompany(MARKERS, 'Waymo');
    // Waymo appears in Mountain View + Austin → 2 markers, 1 role each.
    expect(waymo.map((m) => m.label).sort()).toEqual(['Austin', 'Mountain View']);
    for (const m of waymo) {
      expect(m.roleCount).toBe(1);
      expect(m.companyCount).toBe(1);
      expect(m.roles.every((r) => r.companyName === 'Waymo')).toBe(true);
    }
  });

  it('is case-insensitive and drops non-matching markers', () => {
    const stripe = filterMarkersByCompany(MARKERS, 'stripe');
    expect(stripe).toHaveLength(1);
    expect(stripe[0].label).toBe('San Francisco');
  });

  it('returns an empty set when the company has no roles', () => {
    expect(filterMarkersByCompany(MARKERS, 'Nonexistent Co')).toHaveLength(0);
  });

  it('returns the full set when the query is empty', () => {
    expect(filterMarkersByCompany(MARKERS, '')).toHaveLength(MARKERS.length);
  });
});
