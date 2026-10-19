import { describe, it, expect, vi } from 'vitest';
import { Geocoder, buildLocationQuery } from './geocode';

function fakeFetch(payload: unknown, status = 200) {
  return vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
      _ua: init?.headers?.['User-Agent'],
    } as unknown as Response;
  });
}

describe('Geocoder', () => {
  it('resolves coordinates and sends a descriptive User-Agent', async () => {
    const fetchImpl = fakeFetch([{ lat: '40.7', lon: '-74.0', display_name: 'New York, NY, USA' }]);
    const geo = new Geocoder({ fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 0, userAgent: 'Launchpad/1.0 (admin geocoder)' });
    const result = await geo.geocode('New York, NY, USA');
    expect(result).toMatchObject({ latitude: 40.7, longitude: -74.0 });
    const headers = (fetchImpl.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['User-Agent']).toMatch(/Launchpad/);
  });

  it('caches repeat queries (only one network call)', async () => {
    const fetchImpl = fakeFetch([{ lat: '1', lon: '2', display_name: 'x' }]);
    const geo = new Geocoder({ fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 0 });
    await geo.geocode('same');
    await geo.geocode('same');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throttles to the configured minimum interval', async () => {
    const fetchImpl = fakeFetch([{ lat: '1', lon: '2', display_name: 'x' }]);
    const geo = new Geocoder({ fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 50 });
    const start = Date.now();
    await geo.geocode('a');
    await geo.geocode('b');
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it('returns null when no result is found', async () => {
    const fetchImpl = fakeFetch([]);
    const geo = new Geocoder({ fetchImpl: fetchImpl as unknown as typeof fetch, minIntervalMs: 0 });
    expect(await geo.geocode('nowhere')).toBeNull();
  });
});

describe('buildLocationQuery', () => {
  it('joins present parts and drops empties', () => {
    expect(buildLocationQuery({ city: 'Austin', state: 'TX', country: 'USA' })).toBe('Austin, TX, USA');
    expect(buildLocationQuery({ city: 'Remote', state: null, country: null })).toBe('Remote');
  });
});
