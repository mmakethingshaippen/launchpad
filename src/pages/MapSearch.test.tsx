import { describe, it, expect } from 'vitest';
import { filterMarkersByCompany, companyNamesFromMarkers } from './MapPage';
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
