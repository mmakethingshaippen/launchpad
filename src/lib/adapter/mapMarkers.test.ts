import { describe, it, expect } from 'vitest';
import { buildMapMarkers, type MapRoleInput } from './mapMarkers';

function role(partial: Partial<MapRoleInput>): MapRoleInput {
  return {
    id: 'r' + Math.random().toString(36).slice(2),
    slug: 'role',
    title: 'Intern',
    seasons: ['Summer'],
    cohortYear: 2027,
    locationString: 'Austin, Texas',
    workArrangement: 'Onsite',
    companyId: 'c1',
    companyName: 'Acme',
    companySlug: 'acme',
    companyWebsiteUrl: 'https://acme.com',
    companyLogoUrl: null,
    hqLatitude: 37.7749,
    hqLongitude: -122.4194,
    ...partial,
  };
}

describe('buildMapMarkers', () => {
  it('plots roles at their own city, grouping across companies with role counts', () => {
    const markers = buildMapMarkers([
      role({ id: 'a', locationString: 'Austin, Texas', companyId: 'c1', companyName: 'Acme' }),
      role({ id: 'b', locationString: 'Austin, Texas', companyId: 'c2', companyName: 'Beta' }),
      role({ id: 'c', locationString: 'Seattle, WA', companyId: 'c1', companyName: 'Acme' }),
    ]);

    const austin = markers.find((m) => m.label.startsWith('Austin'))!;
    const seattle = markers.find((m) => m.label.startsWith('Seattle'))!;

    expect(austin.roleCount).toBe(2);
    expect(austin.companyCount).toBe(2); // Acme + Beta
    expect(austin).toMatchObject({ latitude: 30.2672, longitude: -97.7431 });
    expect(seattle.roleCount).toBe(1);
    expect(seattle.companyCount).toBe(1);
  });

  it('splits a multi-city role into a pin per city', () => {
    const markers = buildMapMarkers([role({ id: 'm', locationString: 'New York, Seattle' })]);
    const labels = markers.map((m) => m.label).sort();
    expect(labels.some((l) => l.startsWith('New York'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Seattle'))).toBe(true);
    expect(markers).toHaveLength(2);
    // The same role counts once in each city.
    expect(markers.every((m) => m.roleCount === 1)).toBe(true);
  });

  it('resolves metros like Dallas-Fort Worth and uses state-center fallback', () => {
    const markers = buildMapMarkers([
      role({ id: 'd', locationString: 'Dallas-Fort Worth, Texas' }),
      role({ id: 'e', locationString: 'Tinytown, Texas' }), // unknown city → TX center
    ]);
    const dfw = markers.find((m) => m.label.includes('Dallas-Fort Worth'))!;
    expect(dfw).toMatchObject({ latitude: 32.7673, longitude: -96.7776 });
    const tiny = markers.find((m) => m.label.startsWith('Tinytown'))!;
    // Texas state center.
    expect(tiny.latitude).toBeCloseTo(31.0545, 2);
  });

  it('falls back to company HQ only for Remote / unresolvable locations', () => {
    const markers = buildMapMarkers([
      role({ id: 'rem', locationString: 'Remote', hqLatitude: 37.7749, hqLongitude: -122.4194 }),
      role({ id: 'us', locationString: 'United States', hqLatitude: 40.7128, hqLongitude: -74.006 }),
    ]);
    // Both land on their respective HQ coords.
    expect(markers.some((m) => m.latitude === 37.7749)).toBe(true);
    expect(markers.some((m) => m.latitude === 40.7128)).toBe(true);
  });

  it('includes per-role details with a resolved logo', () => {
    const [marker] = buildMapMarkers([role({ companyWebsiteUrl: 'https://acme.com', companyLogoUrl: null })]);
    expect(marker.roles[0].companyLogoUrl).toContain('icon.horse/icon/acme.com');
    expect(marker.roles[0].title).toBe('Intern');
  });

  it('labels the HQ fallback pin with the real HQ place, never the literal "HQ"', () => {
    const markers = buildMapMarkers([
      role({
        id: 'hq',
        locationString: 'Remote',
        hqLatitude: 37.3541,
        hqLongitude: -121.9552,
        hqCity: 'Santa Clara',
        hqState: 'CA',
      }),
    ]);
    const m = markers[0];
    expect(m.label).toBe('Santa Clara, CA (Remote)');
    expect(m.city).toBe('Santa Clara');
    expect(m.label).not.toBe('HQ');
  });

  // Req 1 — international roles must be geocoded and plotted (not clipped).
  it('plots international roles (London, Toronto, Paris, Tokyo, Sydney)', () => {
    const intl: Array<[string, string]> = [
      ['London', 'London'],
      ['Toronto', 'Toronto'],
      ['Paris', 'Paris'],
      ['Tokyo', 'Tokyo'],
      ['Sydney', 'Sydney'],
    ];
    const markers = buildMapMarkers(
      intl.map(([id, loc]) => role({ id, locationString: loc, companyId: id })),
    );
    for (const [, loc] of intl) {
      expect(markers.some((m) => m.label.startsWith(loc)), loc).toBe(true);
    }
    // Sydney is in the southern hemisphere → negative latitude, proving no
    // North-American bounding-box clipping.
    const sydney = markers.find((m) => m.label.startsWith('Sydney'))!;
    expect(sydney.latitude).toBeLessThan(0);
  });

  // Req 1 — stable marker identity underpins the cluster remount key, so pins
  // don't vanish on pan/zoom (the key only changes when the data truly changes).
  it('produces stable, deterministic marker ids across repeated builds', () => {
    const inputs = [
      role({ id: 'a', locationString: 'London', companyId: 'c1' }),
      role({ id: 'b', locationString: 'Tokyo', companyId: 'c2' }),
      role({ id: 'c', locationString: 'Austin, Texas', companyId: 'c3' }),
    ];
    const first = buildMapMarkers(inputs).map((m) => m.id).sort();
    const second = buildMapMarkers(inputs).map((m) => m.id).sort();
    expect(second).toEqual(first);
    const key = (ms: { id: string; roleCount: number }[]) =>
      ms.map((m) => `${m.id}#${m.roleCount}`).sort().join('|');
    expect(key(buildMapMarkers(inputs))).toBe(key(buildMapMarkers(inputs)));
  });
});
