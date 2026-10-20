import { describe, it, expect } from 'vitest';
import { lookupCity, resolveRoleCoords, isRemoteLocation } from './cityCoords';

describe('lookupCity', () => {
  it('resolves major hubs and tolerates trailing state/country', () => {
    expect(lookupCity('Seattle')).toMatchObject({ latitude: 47.6062, longitude: -122.3321 });
    expect(lookupCity('Seattle, WA')).toMatchObject({ latitude: 47.6062 });
    expect(lookupCity('Singapore')).toMatchObject({ latitude: 1.3521 });
    expect(lookupCity('Bengaluru')).toMatchObject({ latitude: 12.9716 });
    expect(lookupCity('bangalore')).toMatchObject({ latitude: 12.9716 }); // alias
  });

  it('returns null for unknown cities', () => {
    expect(lookupCity('Nowhereville')).toBeNull();
    expect(lookupCity(null)).toBeNull();
  });
});

describe('resolveRoleCoords', () => {
  it('matches the first recognized city in a multi-city string', () => {
    const r = resolveRoleCoords('New York, Seattle');
    expect(r).not.toBeNull();
    // "New York" is first and recognized.
    expect(r).toMatchObject({ latitude: 40.7128, longitude: -74.006 });
  });

  it('skips an unrecognized leading token and finds a known city', () => {
    const r = resolveRoleCoords('Unknownville / Tokyo');
    expect(r).toMatchObject({ latitude: 35.6762 });
  });

  it('returns null when no token is a known city', () => {
    expect(resolveRoleCoords('Atlantis, El Dorado')).toBeNull();
  });
});

describe('isRemoteLocation', () => {
  it('detects remote variants', () => {
    expect(isRemoteLocation('Remote')).toBe(true);
    expect(isRemoteLocation('Remote - US')).toBe(true);
    expect(isRemoteLocation('Anywhere')).toBe(true);
    expect(isRemoteLocation('New York')).toBe(false);
  });
});
