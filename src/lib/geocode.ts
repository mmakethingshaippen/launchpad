export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export interface GeocodeOptions {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
}

const DEFAULT_UA = 'Launchpad/1.0 (admin geocoder)';

/**
 * Nominatim geocoder with a 1-request-per-second queue and a descriptive
 * User-Agent, per OSM usage policy (decision #6). Results are cached in-memory
 * per query string. Intended for admin use at approval time — never called on
 * public page load.
 */
export class Geocoder {
  private last = 0;
  private readonly cache = new Map<string, GeocodeResult | null>();
  private readonly ua: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minInterval: number;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: GeocodeOptions = {}) {
    this.ua = opts.userAgent ?? DEFAULT_UA;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minInterval = opts.minIntervalMs ?? 1000;
  }

  private async throttle(): Promise<void> {
    const wait = Math.max(0, this.last + this.minInterval - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }

  /** Serialize calls so requests are at most one per interval. */
  async geocode(query: string): Promise<GeocodeResult | null> {
    if (this.cache.has(query)) return this.cache.get(query)!;

    const run = this.chain.then(async () => {
      if (this.cache.has(query)) return this.cache.get(query)!;
      await this.throttle();
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
      const res = await this.fetchImpl(url, { headers: { 'User-Agent': this.ua } });
      if (!res.ok) {
        this.cache.set(query, null);
        return null;
      }
      const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      const first = data[0];
      const result: GeocodeResult | null = first
        ? { latitude: Number(first.lat), longitude: Number(first.lon), displayName: first.display_name }
        : null;
      this.cache.set(query, result);
      return result;
    });

    // keep the chain alive even if this call rejects
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export function buildLocationQuery(parts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}): string {
  return [parts.city, parts.state, parts.country].filter(Boolean).join(', ');
}
