import { describe, it, expect } from 'vitest';
import { lookupCity, resolveRoleCoords, isRemoteLocation, normalizeLongitude } from './cityCoords';

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

  it('does NOT flag physical international locations as remote (Req 2)', () => {
    expect(isRemoteLocation('Betim, MG, Brazil')).toBe(false);
    expect(isRemoteLocation('San Fernando De Henares, ESP')).toBe(false);
    expect(isRemoteLocation('BRA, MG, Betim')).toBe(false);
    expect(isRemoteLocation('Singapore, SGP')).toBe(false);
  });
});

describe('normalizeLongitude (world-wrap fix)', () => {
  it('leaves in-range longitudes unchanged', () => {
    expect(normalizeLongitude(0)).toBe(0);
    expect(normalizeLongitude(-122.4194)).toBeCloseTo(-122.4194, 4);
    expect(normalizeLongitude(139.6503)).toBeCloseTo(139.6503, 4);
  });

  it('wraps longitudes beyond ±180 back into [-180,180)', () => {
    // Panning one world copy left/right shifts longitude by ±360.
    expect(normalizeLongitude(-122.4194 - 360)).toBeCloseTo(-122.4194, 4);
    expect(normalizeLongitude(139.6503 + 360)).toBeCloseTo(139.6503, 4);
    expect(normalizeLongitude(200)).toBeCloseTo(-160, 4);
    expect(normalizeLongitude(-200)).toBeCloseTo(160, 4);
  });
});
