/**
 * Deterministic city → latitude/longitude lookup for major tech hubs.
 *
 * Used during ATS sync to plot each role at its actual job city rather than the
 * company HQ. Offline + deterministic (no network), so sync stays fast and
 * reproducible. Unknown cities / "Remote" fall back to the company HQ.
 */
export interface CityCoord {
  latitude: number;
  longitude: number;
}

/** Normalize a city token for matching: lowercase, strip punctuation/extra ws. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keyed by normalized city name (and common aliases). Coordinates are city-center.
const CITIES: Record<string, CityCoord> = {
  // ── United States ──
  'san francisco': { latitude: 37.7749, longitude: -122.4194 },
  sf: { latitude: 37.7749, longitude: -122.4194 },
  'south san francisco': { latitude: 37.6547, longitude: -122.4077 },
  'san jose': { latitude: 37.3382, longitude: -121.8863 },
  'palo alto': { latitude: 37.4419, longitude: -122.143 },
  'mountain view': { latitude: 37.3861, longitude: -122.0839 },
  sunnyvale: { latitude: 37.3688, longitude: -122.0363 },
  'menlo park': { latitude: 37.4538, longitude: -122.1822 },
  'santa clara': { latitude: 37.3541, longitude: -121.9552 },
  cupertino: { latitude: 37.322, longitude: -122.0322 },
  oakland: { latitude: 37.8044, longitude: -122.2712 },
  'los angeles': { latitude: 34.0522, longitude: -118.2437 },
  la: { latitude: 34.0522, longitude: -118.2437 },
  'long beach': { latitude: 33.7701, longitude: -118.1937 },
  'costa mesa': { latitude: 33.6411, longitude: -117.9187 },
  'san diego': { latitude: 32.7157, longitude: -117.1611 },
  seattle: { latitude: 47.6062, longitude: -122.3321 },
  bellevue: { latitude: 47.6101, longitude: -122.2015 },
  redmond: { latitude: 47.674, longitude: -122.1215 },
  portland: { latitude: 45.5152, longitude: -122.6784 },
  'new york': { latitude: 40.7128, longitude: -74.006 },
  'new york city': { latitude: 40.7128, longitude: -74.006 },
  nyc: { latitude: 40.7128, longitude: -74.006 },
  brooklyn: { latitude: 40.6782, longitude: -73.9442 },
  boston: { latitude: 42.3601, longitude: -71.0589 },
  cambridge: { latitude: 42.3736, longitude: -71.1097 },
  somerville: { latitude: 42.3876, longitude: -71.0995 },
  chicago: { latitude: 41.8781, longitude: -87.6298 },
  austin: { latitude: 30.2672, longitude: -97.7431 },
  dallas: { latitude: 32.7767, longitude: -96.797 },
  houston: { latitude: 29.7604, longitude: -95.3698 },
  denver: { latitude: 39.7392, longitude: -104.9903 },
  boulder: { latitude: 40.015, longitude: -105.2705 },
  atlanta: { latitude: 33.749, longitude: -84.388 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  'washington': { latitude: 38.9072, longitude: -77.0369 },
  'washington dc': { latitude: 38.9072, longitude: -77.0369 },
  'washington, dc': { latitude: 38.9072, longitude: -77.0369 },
  arlington: { latitude: 38.8816, longitude: -77.0910 },
  'salt lake city': { latitude: 40.7608, longitude: -111.891 },
  phoenix: { latitude: 33.4484, longitude: -112.074 },
  nashville: { latitude: 36.1627, longitude: -86.7816 },
  pittsburgh: { latitude: 40.4406, longitude: -79.9959 },
  minneapolis: { latitude: 44.9778, longitude: -93.265 },
  'raleigh': { latitude: 35.7796, longitude: -78.6382 },
  durham: { latitude: 35.994, longitude: -78.8986 },
  philadelphia: { latitude: 39.9526, longitude: -75.1652 },
  detroit: { latitude: 42.3314, longitude: -83.0458 },

  // ── Canada ──
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  vancouver: { latitude: 49.2827, longitude: -123.1207 },
  montreal: { latitude: 45.5019, longitude: -73.5674 },
  waterloo: { latitude: 43.4643, longitude: -80.5204 },
  ottawa: { latitude: 45.4215, longitude: -75.6972 },

  // ── Europe ──
  london: { latitude: 51.5074, longitude: -0.1278 },
  dublin: { latitude: 53.3498, longitude: -6.2603 },
  berlin: { latitude: 52.52, longitude: 13.405 },
  paris: { latitude: 48.8566, longitude: 2.3522 },
  amsterdam: { latitude: 52.3676, longitude: 4.9041 },
  madrid: { latitude: 40.4168, longitude: -3.7038 },
  barcelona: { latitude: 41.3851, longitude: 2.1734 },
  munich: { latitude: 48.1351, longitude: 11.582 },
  zurich: { latitude: 47.3769, longitude: 8.5417 },
  stockholm: { latitude: 59.3293, longitude: 18.0686 },
  lisbon: { latitude: 38.7223, longitude: -9.1393 },
  warsaw: { latitude: 52.2297, longitude: 21.0122 },

  // ── Asia-Pacific ──
  singapore: { latitude: 1.3521, longitude: 103.8198 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  hyderabad: { latitude: 17.385, longitude: 78.4867 },
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  'new delhi': { latitude: 28.6139, longitude: 77.209 },
  gurgaon: { latitude: 28.4595, longitude: 77.0266 },
  pune: { latitude: 18.5204, longitude: 73.8567 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
  'hong kong': { latitude: 22.3193, longitude: 114.1694 },
  shanghai: { latitude: 31.2304, longitude: 121.4737 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
  melbourne: { latitude: -37.8136, longitude: 144.9631 },
  'tel aviv': { latitude: 32.0853, longitude: 34.7818 },
  bangkok: { latitude: 13.7563, longitude: 100.5018 },
  seoul: { latitude: 37.5665, longitude: 126.978 },

  // ── Latin America ──
  'são paulo': { latitude: -23.5505, longitude: -46.6333 },
  'sao paulo': { latitude: -23.5505, longitude: -46.6333 },
  'mexico city': { latitude: 19.4326, longitude: -99.1332 },
};

/**
 * Resolve a single city name to coordinates, or null if unknown.
 * Tolerant of trailing state/country (e.g. "Seattle, WA" → tries "seattle").
 */
export function lookupCity(raw: string | null | undefined): CityCoord | null {
  if (!raw) return null;
  const whole = norm(raw);
  if (CITIES[whole]) return CITIES[whole];

  // Try the first comma-separated segment (the city part).
  const firstSegment = norm(raw.split(',')[0] ?? '');
  if (firstSegment && CITIES[firstSegment]) return CITIES[firstSegment];

  // Try each comma-separated segment (handles "USA, Seattle" ordering).
  for (const seg of raw.split(',')) {
    const key = norm(seg);
    if (CITIES[key]) return CITIES[key];
  }
  return null;
}

/**
 * Resolve the first recognized city from a possibly multi-city location string
 * like "New York, Seattle" or "San Francisco / Remote". Returns the coordinate
 * plus the matched city label, or null if nothing matches.
 */
export function resolveRoleCoords(
  location: string | null | undefined,
): { latitude: number; longitude: number; city: string } | null {
  if (!location) return null;

  // Split on commas, slashes, pipes, " or ", " and ", semicolons.
  const tokens = location
    .split(/[,/|;]|\bor\b|\band\b/i)
    .map((t) => t.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const hit = lookupCity(token);
    if (hit) return { ...hit, city: titleCase(token) };
  }
  // Last resort: try the whole string.
  const whole = lookupCity(location);
  if (whole) return { ...whole, city: titleCase(location.split(',')[0] ?? location) };
  return null;
}

function titleCase(s: string): string {
  return s
    .trim()
    .split(' ')
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function isRemoteLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return /\bremote\b|\banywhere\b|\bwork from home\b|\bwfh\b/i.test(location);
}
