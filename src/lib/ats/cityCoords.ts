/**
 * Deterministic city / metro / state → latitude-longitude lookup.
 *
 * Used to plot each role at its actual job city (not the company HQ). Offline
 * and deterministic (no network), so sync + map stay fast and reproducible.
 * Resolution order for a location token: exact city/metro → state center.
 * Only Remote / country-only / unrecognizable strings fall back to company HQ.
 */
export interface CityCoord {
  latitude: number;
  longitude: number;
}

export interface ResolvedPlace extends CityCoord {
  /** Human label for the pin, e.g. "Austin, TX" or "California". */
  label: string;
  city: string | null;
  state: string | null; // 2-letter where known
}

/** Normalize a token for matching: lowercase, strip punctuation/extra ws. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keyed by normalized city/metro name (plus common aliases). City-center coords.
const CITIES: Record<string, CityCoord> = {
  // ── United States — Bay Area ──
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
  'foster city': { latitude: 37.5585, longitude: -122.2711 },
  'redwood city': { latitude: 37.4852, longitude: -122.2364 },
  'san mateo': { latitude: 37.563, longitude: -122.3255 },
  'san bruno': { latitude: 37.6305, longitude: -122.4111 },
  oakland: { latitude: 37.8044, longitude: -122.2712 },
  emeryville: { latitude: 37.8313, longitude: -122.2852 },
  berkeley: { latitude: 37.8715, longitude: -122.273 },
  pleasanton: { latitude: 37.6624, longitude: -121.8747 },
  'bay area': { latitude: 37.7749, longitude: -122.4194 },
  'silicon valley': { latitude: 37.3875, longitude: -122.0575 },

  // ── US — SoCal ──
  'los angeles': { latitude: 34.0522, longitude: -118.2437 },
  la: { latitude: 34.0522, longitude: -118.2437 },
  'long beach': { latitude: 33.7701, longitude: -118.1937 },
  'costa mesa': { latitude: 33.6411, longitude: -117.9187 },
  irvine: { latitude: 33.6846, longitude: -117.8265 },
  'santa monica': { latitude: 34.0195, longitude: -118.4912 },
  hawthorne: { latitude: 33.9164, longitude: -118.3526 },
  'san diego': { latitude: 32.7157, longitude: -117.1611 },

  // ── US — Pacific NW ──
  seattle: { latitude: 47.6062, longitude: -122.3321 },
  bellevue: { latitude: 47.6101, longitude: -122.2015 },
  redmond: { latitude: 47.674, longitude: -122.1215 },
  kirkland: { latitude: 47.6815, longitude: -122.2087 },
  portland: { latitude: 45.5152, longitude: -122.6784 },

  // ── US — Northeast ──
  'new york': { latitude: 40.7128, longitude: -74.006 },
  'new york city': { latitude: 40.7128, longitude: -74.006 },
  nyc: { latitude: 40.7128, longitude: -74.006 },
  manhattan: { latitude: 40.7831, longitude: -73.9712 },
  brooklyn: { latitude: 40.6782, longitude: -73.9442 },
  boston: { latitude: 42.3601, longitude: -71.0589 },
  cambridge: { latitude: 42.3736, longitude: -71.1097 },
  somerville: { latitude: 42.3876, longitude: -71.0995 },
  philadelphia: { latitude: 39.9526, longitude: -75.1652 },
  pittsburgh: { latitude: 40.4406, longitude: -79.9959 },
  purchase: { latitude: 41.0409, longitude: -73.7154 },
  stamford: { latitude: 41.0534, longitude: -73.5387 },
  'jersey city': { latitude: 40.7178, longitude: -74.0431 },
  princeton: { latitude: 40.3573, longitude: -74.6672 },

  // ── US — DC / Mid-Atlantic / South ──
  washington: { latitude: 38.9072, longitude: -77.0369 },
  'washington dc': { latitude: 38.9072, longitude: -77.0369 },
  arlington: { latitude: 38.8816, longitude: -77.091 },
  reston: { latitude: 38.9586, longitude: -77.357 },
  mclean: { latitude: 38.9339, longitude: -77.1773 },
  atlanta: { latitude: 33.749, longitude: -84.388 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  charlotte: { latitude: 35.2271, longitude: -80.8431 },
  nashville: { latitude: 36.1627, longitude: -86.7816 },
  raleigh: { latitude: 35.7796, longitude: -78.6382 },
  durham: { latitude: 35.994, longitude: -78.8986 },
  woonsocket: { latitude: 42.0029, longitude: -71.5147 },

  // ── US — Texas (incl. metros) ──
  austin: { latitude: 30.2672, longitude: -97.7431 },
  dallas: { latitude: 32.7767, longitude: -96.797 },
  'fort worth': { latitude: 32.7555, longitude: -97.3308 },
  'dallas-fort worth': { latitude: 32.7673, longitude: -96.7776 },
  'dallas fort worth': { latitude: 32.7673, longitude: -96.7776 },
  dfw: { latitude: 32.7673, longitude: -96.7776 },
  'dallas/fort worth': { latitude: 32.7673, longitude: -96.7776 },
  houston: { latitude: 29.7604, longitude: -95.3698 },
  'san antonio': { latitude: 29.4241, longitude: -98.4936 },
  plano: { latitude: 33.0198, longitude: -96.6989 },

  // ── US — Mountain / Midwest ──
  denver: { latitude: 39.7392, longitude: -104.9903 },
  boulder: { latitude: 40.015, longitude: -105.2705 },
  'salt lake city': { latitude: 40.7608, longitude: -111.891 },
  phoenix: { latitude: 33.4484, longitude: -112.074 },
  tempe: { latitude: 33.4255, longitude: -111.94 },
  chicago: { latitude: 41.8781, longitude: -87.6298 },
  minneapolis: { latitude: 44.9778, longitude: -93.265 },
  detroit: { latitude: 42.3314, longitude: -83.0458 },
  'ann arbor': { latitude: 42.2808, longitude: -83.743 },
  columbus: { latitude: 39.9612, longitude: -82.9988 },

  // ── Canada ──
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  vancouver: { latitude: 49.2827, longitude: -123.1207 },
  montreal: { latitude: 45.5019, longitude: -73.5674 },
  waterloo: { latitude: 43.4643, longitude: -80.5204 },
  ottawa: { latitude: 45.4215, longitude: -75.6972 },
  calgary: { latitude: 51.0447, longitude: -114.0719 },

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

// US state centers (fallback when the specific city isn't in the table but a
// state name/abbreviation is present). Keyed by both full name and abbreviation.
interface StateInfo {
  abbr: string;
  latitude: number;
  longitude: number;
}
const STATES: Record<string, StateInfo> = {
  alabama: { abbr: 'AL', latitude: 32.806, longitude: -86.791 },
  alaska: { abbr: 'AK', latitude: 61.37, longitude: -152.404 },
  arizona: { abbr: 'AZ', latitude: 33.729, longitude: -111.431 },
  arkansas: { abbr: 'AR', latitude: 34.97, longitude: -92.373 },
  california: { abbr: 'CA', latitude: 36.1162, longitude: -119.6816 },
  colorado: { abbr: 'CO', latitude: 39.0598, longitude: -105.3111 },
  connecticut: { abbr: 'CT', latitude: 41.5978, longitude: -72.7554 },
  delaware: { abbr: 'DE', latitude: 39.3185, longitude: -75.5071 },
  florida: { abbr: 'FL', latitude: 27.7663, longitude: -81.6868 },
  georgia: { abbr: 'GA', latitude: 33.0406, longitude: -83.6431 },
  hawaii: { abbr: 'HI', latitude: 21.0943, longitude: -157.4983 },
  idaho: { abbr: 'ID', latitude: 44.2405, longitude: -114.4788 },
  illinois: { abbr: 'IL', latitude: 40.3495, longitude: -88.9861 },
  indiana: { abbr: 'IN', latitude: 39.8494, longitude: -86.2583 },
  iowa: { abbr: 'IA', latitude: 42.0115, longitude: -93.2105 },
  kansas: { abbr: 'KS', latitude: 38.5266, longitude: -96.7265 },
  kentucky: { abbr: 'KY', latitude: 37.6681, longitude: -84.6701 },
  louisiana: { abbr: 'LA', latitude: 31.1695, longitude: -91.8678 },
  maine: { abbr: 'ME', latitude: 44.6939, longitude: -69.3819 },
  maryland: { abbr: 'MD', latitude: 39.0639, longitude: -76.8021 },
  massachusetts: { abbr: 'MA', latitude: 42.2302, longitude: -71.5301 },
  michigan: { abbr: 'MI', latitude: 43.3266, longitude: -84.5361 },
  minnesota: { abbr: 'MN', latitude: 45.6945, longitude: -93.9002 },
  mississippi: { abbr: 'MS', latitude: 32.7416, longitude: -89.6787 },
  missouri: { abbr: 'MO', latitude: 38.4561, longitude: -92.2884 },
  montana: { abbr: 'MT', latitude: 46.9219, longitude: -110.4544 },
  nebraska: { abbr: 'NE', latitude: 41.1254, longitude: -98.2681 },
  nevada: { abbr: 'NV', latitude: 38.3135, longitude: -117.0554 },
  'new hampshire': { abbr: 'NH', latitude: 43.4525, longitude: -71.5639 },
  'new jersey': { abbr: 'NJ', latitude: 40.2989, longitude: -74.521 },
  'new mexico': { abbr: 'NM', latitude: 34.8405, longitude: -106.2485 },
  'new york state': { abbr: 'NY', latitude: 42.1657, longitude: -74.9481 },
  'north carolina': { abbr: 'NC', latitude: 35.6301, longitude: -79.8064 },
  'north dakota': { abbr: 'ND', latitude: 47.5289, longitude: -99.784 },
  ohio: { abbr: 'OH', latitude: 40.3888, longitude: -82.7649 },
  oklahoma: { abbr: 'OK', latitude: 35.5653, longitude: -96.9289 },
  oregon: { abbr: 'OR', latitude: 44.572, longitude: -122.0709 },
  pennsylvania: { abbr: 'PA', latitude: 40.5908, longitude: -77.2098 },
  'rhode island': { abbr: 'RI', latitude: 41.6809, longitude: -71.5118 },
  'south carolina': { abbr: 'SC', latitude: 33.8569, longitude: -80.945 },
  'south dakota': { abbr: 'SD', latitude: 44.2998, longitude: -99.4388 },
  tennessee: { abbr: 'TN', latitude: 35.7478, longitude: -86.6923 },
  texas: { abbr: 'TX', latitude: 31.0545, longitude: -97.5635 },
  utah: { abbr: 'UT', latitude: 40.15, longitude: -111.8624 },
  vermont: { abbr: 'VT', latitude: 44.0459, longitude: -72.7107 },
  virginia: { abbr: 'VA', latitude: 37.7693, longitude: -78.17 },
  washington_state: { abbr: 'WA', latitude: 47.4009, longitude: -121.4905 },
  'west virginia': { abbr: 'WV', latitude: 38.4912, longitude: -80.9545 },
  wisconsin: { abbr: 'WI', latitude: 44.2685, longitude: -89.6165 },
  wyoming: { abbr: 'WY', latitude: 42.756, longitude: -107.3025 },
};
// Abbreviation → state info.
const STATE_BY_ABBR: Record<string, StateInfo> = {};
for (const info of Object.values(STATES)) STATE_BY_ABBR[info.abbr.toLowerCase()] = info;
// "washington" (the state) collides with the city DC; handled explicitly below.

/**
 * Whether a token is unambiguously a state qualifier (not also a city), used to
 * decide if a comma chunk is "City, State" vs a multi-city list. A 2-letter
 * abbreviation or a state-only name (e.g. "Texas", not "New York") qualifies.
 */
function isUnambiguousStateQualifier(token: string): boolean {
  const key = norm(token);
  if (STATE_BY_ABBR[key]) return true; // e.g. "TX", "CA"
  if (CITIES[key]) return false; // ambiguous (also a city) → not a qualifier
  return Boolean(STATES[key]); // a plain state name like "texas"
}

/** Map a free-form state token (name or abbr) to its info, or null. */
function lookupState(token: string): StateInfo | null {
  const key = norm(token);
  if (STATES[key]) return STATES[key];
  if (key === 'new york' /* ambiguous with the city */) return STATES['new york state'];
  if (key === 'washington') return STATES['washington_state'];
  if (STATE_BY_ABBR[key]) return STATE_BY_ABBR[key];
  return null;
}

/** Resolve a single city token to coordinates, or null if unknown. */
export function lookupCity(raw: string | null | undefined): CityCoord | null {
  if (!raw) return null;
  const whole = norm(raw);
  if (CITIES[whole]) return CITIES[whole];
  const firstSegment = norm(raw.split(',')[0] ?? '');
  if (firstSegment && CITIES[firstSegment]) return CITIES[firstSegment];
  for (const seg of raw.split(',')) {
    const key = norm(seg);
    if (CITIES[key]) return CITIES[key];
  }
  return null;
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  // Lowercase 2-letter tokens that aren't hyphenated stay upper (e.g. state abbr),
  // otherwise capitalize each hyphen-separated part.
  if (w.length <= 2 && !w.includes('-')) return w.toUpperCase();
  return w
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join('-');
}

function titleCase(s: string): string {
  return s.trim().split(' ').map(titleCaseWord).join(' ');
}

// US state abbreviations set, to detect the "City, ST" pattern.
const US_STATE_ABBRS = new Set(Object.keys(STATE_BY_ABBR));

/**
 * Resolve a single "City, State" (or "City, ST") chunk to a place.
 * Tries the exact city first, then the state center as a fallback.
 */
function resolveChunk(chunk: string): ResolvedPlace | null {
  const segments = chunk.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const cityPart = segments[0];
  const statePart = segments[1];
  const stateInfo = statePart ? lookupState(statePart) : null;
  const stateAbbr = stateInfo?.abbr ?? (statePart && US_STATE_ABBRS.has(norm(statePart)) ? statePart.toUpperCase() : null);

  // 1) Exact city (any segment).
  const cityCoord = lookupCity(chunk);
  if (cityCoord) {
    return {
      ...cityCoord,
      label: stateAbbr ? `${titleCase(cityPart)}, ${stateAbbr}` : titleCase(cityPart),
      city: titleCase(cityPart),
      state: stateAbbr,
    };
  }

  // 2) State-center fallback (city unknown but we recognize the state).
  if (stateInfo) {
    return {
      latitude: stateInfo.latitude,
      longitude: stateInfo.longitude,
      label: `${titleCase(cityPart)}, ${stateInfo.abbr}`,
      city: titleCase(cityPart),
      state: stateInfo.abbr,
    };
  }
  // The first segment itself might BE a state (e.g. "Texas").
  const asState = lookupState(cityPart);
  if (asState) {
    return {
      latitude: asState.latitude,
      longitude: asState.longitude,
      label: titleCase(cityPart),
      city: null,
      state: asState.abbr,
    };
  }

  return null;
}

// Tokens that mean "no physical location" → should fall back to HQ.
const NON_PHYSICAL = /^(remote|anywhere|united states|usa|us|u\.s\.|work from home|wfh|global|multiple locations)$/i;

export function isRemoteLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return /\bremote\b|\banywhere\b|\bwork from home\b|\bwfh\b/i.test(location);
}

/**
 * Resolve ALL distinct places from a (possibly multi-city) location string.
 *
 * - "Austin, Texas" → [Austin, TX]
 * - "New York, Seattle" → [New York, Seattle]  (two separate pins)
 * - "Dallas-Fort Worth, Texas" → [Dallas-Fort Worth, TX]
 * - "San Francisco, CA; Austin, TX" → [SF, Austin]
 * - "Remote" / "United States" → []  (caller falls back to HQ)
 *
 * Splits on separators but keeps "City, State" pairs together by treating a
 * state token as attaching to the preceding city.
 */
export function resolveAllRoleCoords(location: string | null | undefined): ResolvedPlace[] {
  if (!location) return [];
  if (NON_PHYSICAL.test(location.trim())) return [];

  // Split into chunks on strong separators: slash, pipe, semicolon, " or ",
  // " and ", and bullet. Commas are handled inside resolveChunk (City, State).
  const rawChunks = location
    .split(/[/|;•]|\bor\b|\band\b|\n/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const places: ResolvedPlace[] = [];
  const seen = new Set<string>();

  const pushChunk = (chunk: string) => {
    const place = resolveChunk(chunk);
    if (place) {
      const k = `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
      if (!seen.has(k)) {
        seen.add(k);
        places.push(place);
      }
    }
  };

  for (const chunk of rawChunks) {
    // A chunk like "New York, Seattle" is two cities, not "City, State".
    // Heuristic: treat it as multiple cities when every comma segment resolves
    // as a city AND none is an *unambiguous* state qualifier (2-letter abbr or a
    // state-only name like "Texas"). This keeps "City, State" pairs together
    // while splitting genuine multi-city lists (incl. ambiguous names like
    // "New York" or "Washington" that are primarily cities here).
    const segs = chunk.split(',').map((s) => s.trim()).filter(Boolean);
    const everyCity = segs.length >= 2 && segs.every((s) => lookupCity(s));
    const anyUnambiguousState = segs.some((s) => isUnambiguousStateQualifier(s));
    if (everyCity && !anyUnambiguousState) {
      for (const s of segs) pushChunk(s);
    } else {
      pushChunk(chunk);
    }
  }

  return places;
}

/**
 * Back-compat single-result resolver (first recognized place). Retained for the
 * sync sink, which stores one representative coordinate per role row.
 */
export function resolveRoleCoords(
  location: string | null | undefined,
): { latitude: number; longitude: number; city: string } | null {
  const all = resolveAllRoleCoords(location);
  if (all.length === 0) return null;
  const first = all[0];
  return { latitude: first.latitude, longitude: first.longitude, city: first.city ?? first.label };
}
