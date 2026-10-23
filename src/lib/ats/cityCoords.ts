/**
 * Deterministic city / metro / state / country → latitude-longitude lookup.
 *
 * Used to plot each role at its actual job city (not the company HQ). Offline
 * and deterministic (no network), so sync + map stay fast and reproducible.
 * Resolution order for a location token: exact city/metro → state/province → country.
 * Only pure Remote / unrecognizable strings fall back to company HQ.
 */
export interface CityCoord {
  latitude: number;
  longitude: number;
}

export interface ResolvedPlace extends CityCoord {
  /** Human label for the pin, e.g. "Austin, TX" or "Shanghai". */
  label: string;
  city: string | null;
  state: string | null; // 2-letter where known
}

/** Normalize a token for matching: lowercase, strip accents, punctuation/extra ws. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clean ATS noise like numeric region codes ("Shanghai, 31") or work-mode prefixes. */
function cleanLocationChunk(raw: string): string {
  return raw
    .replace(/\b(remote|hybrid|on-?site|in-?office)\b\s*(?:-|:|–)?\s*/gi, '')
    .replace(/\s+[-–]\s+/g, ', ')
    .replace(/,\s*\d+\b/g, '') // Strip numeric ATS province codes like ", 31"
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
  fremont: { latitude: 37.5485, longitude: -121.9886 },
  milpitas: { latitude: 37.4323, longitude: -121.8996 },
  'los gatos': { latitude: 37.2358, longitude: -121.9624 },
  'walnut creek': { latitude: 37.9101, longitude: -122.0652 },
  'san ramon': { latitude: 37.7799, longitude: -121.978 },
  alameda: { latitude: 37.7652, longitude: -122.2416 },
  'bay area': { latitude: 37.7749, longitude: -122.4194 },
  'silicon valley': { latitude: 37.3875, longitude: -122.0575 },
  sacramento: { latitude: 38.5816, longitude: -121.4944 },

  // ── US — SoCal ──
  'los angeles': { latitude: 34.0522, longitude: -118.2437 },
  la: { latitude: 34.0522, longitude: -118.2437 },
  'long beach': { latitude: 33.7701, longitude: -118.1937 },
  'costa mesa': { latitude: 33.6411, longitude: -117.9187 },
  irvine: { latitude: 33.6846, longitude: -117.8265 },
  'santa monica': { latitude: 34.0195, longitude: -118.4912 },
  'culver city': { latitude: 34.0211, longitude: -118.3965 },
  'el segundo': { latitude: 33.9192, longitude: -118.4165 },
  pasadena: { latitude: 34.1478, longitude: -118.1445 },
  burbank: { latitude: 34.1808, longitude: -118.309 },
  'newport beach': { latitude: 33.6189, longitude: -117.9289 },
  hawthorne: { latitude: 33.9164, longitude: -118.3526 },
  'san diego': { latitude: 32.7157, longitude: -117.1611 },
  carlsbad: { latitude: 33.1581, longitude: -117.3506 },
  'santa barbara': { latitude: 34.4208, longitude: -119.6982 },

  // ── US — Pacific NW ──
  seattle: { latitude: 47.6062, longitude: -122.3321 },
  bellevue: { latitude: 47.6101, longitude: -122.2015 },
  redmond: { latitude: 47.674, longitude: -122.1215 },
  kirkland: { latitude: 47.6815, longitude: -122.2087 },
  tacoma: { latitude: 47.2529, longitude: -122.4443 },
  portland: { latitude: 45.5152, longitude: -122.6784 },
  beaverton: { latitude: 45.4871, longitude: -122.8037 },
  hillsboro: { latitude: 45.5229, longitude: -122.9898 },

  // ── US — Hawaii, Alaska & Pacific ──
  honolulu: { latitude: 21.3069, longitude: -157.8583 },
  hawaii: { latitude: 19.8968, longitude: -155.5828 },
  hilo: { latitude: 19.7297, longitude: -155.09 },
  kailua: { latitude: 21.4022, longitude: -157.7394 },
  oahu: { latitude: 21.4389, longitude: -158.0001 },
  maui: { latitude: 20.7984, longitude: -156.3319 },
  'pearl harbor': { latitude: 21.3539, longitude: -157.9402 },
  anchorage: { latitude: 61.2181, longitude: -149.9003 },
  fairbanks: { latitude: 64.8378, longitude: -147.7164 },
  juneau: { latitude: 58.3019, longitude: -134.4197 },

  // ── US — Northeast ──
  'new york': { latitude: 40.7128, longitude: -74.006 },
  'new york city': { latitude: 40.7128, longitude: -74.006 },
  nyc: { latitude: 40.7128, longitude: -74.006 },
  manhattan: { latitude: 40.7831, longitude: -73.9712 },
  brooklyn: { latitude: 40.6782, longitude: -73.9442 },
  armonk: { latitude: 41.1265, longitude: -73.714 },
  'white plains': { latitude: 41.034, longitude: -73.7629 },
  boston: { latitude: 42.3601, longitude: -71.0589 },
  cambridge: { latitude: 42.3736, longitude: -71.1097 },
  somerville: { latitude: 42.3876, longitude: -71.0995 },
  waltham: { latitude: 42.3765, longitude: -71.2356 },
  framingham: { latitude: 42.2793, longitude: -71.4162 },
  philadelphia: { latitude: 39.9526, longitude: -75.1652 },
  malvern: { latitude: 40.0362, longitude: -75.5138 },
  pittsburgh: { latitude: 40.4406, longitude: -79.9959 },
  purchase: { latitude: 41.0409, longitude: -73.7154 },
  stamford: { latitude: 41.0534, longitude: -73.5387 },
  hartford: { latitude: 41.7658, longitude: -72.6734 },
  'jersey city': { latitude: 40.7178, longitude: -74.0431 },
  hoboken: { latitude: 40.744, longitude: -74.0324 },
  newark: { latitude: 40.7357, longitude: -74.1724 },
  princeton: { latitude: 40.3573, longitude: -74.6672 },
  providence: { latitude: 41.824, longitude: -71.4128 },
  woonsocket: { latitude: 42.0029, longitude: -71.5147 },

  // ── US — DC / Mid-Atlantic / South ──
  washington: { latitude: 38.9072, longitude: -77.0369 },
  'washington dc': { latitude: 38.9072, longitude: -77.0369 },
  arlington: { latitude: 38.8816, longitude: -77.091 },
  reston: { latitude: 38.9586, longitude: -77.357 },
  herndon: { latitude: 38.9696, longitude: -77.3861 },
  mclean: { latitude: 38.9339, longitude: -77.1773 },
  tysons: { latitude: 38.9187, longitude: -77.2311 },
  alexandria: { latitude: 38.8048, longitude: -77.0469 },
  bethesda: { latitude: 38.9847, longitude: -77.0947 },
  baltimore: { latitude: 39.2904, longitude: -76.6122 },
  richmond: { latitude: 37.5407, longitude: -77.436 },
  atlanta: { latitude: 33.749, longitude: -84.388 },
  alpharetta: { latitude: 34.0754, longitude: -84.2941 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  'fort lauderdale': { latitude: 26.1224, longitude: -80.1373 },
  'boca raton': { latitude: 26.3683, longitude: -80.1289 },
  orlando: { latitude: 28.5383, longitude: -81.3792 },
  tampa: { latitude: 27.9506, longitude: -82.4572 },
  charlotte: { latitude: 35.2271, longitude: -80.8431 },
  nashville: { latitude: 36.1627, longitude: -86.7816 },
  raleigh: { latitude: 35.7796, longitude: -78.6382 },
  durham: { latitude: 35.994, longitude: -78.8986 },
  cary: { latitude: 35.7915, longitude: -78.7811 },

  // ── US — Texas ──
  austin: { latitude: 30.2672, longitude: -97.7431 },
  dallas: { latitude: 32.7767, longitude: -96.797 },
  'fort worth': { latitude: 32.7555, longitude: -97.3308 },
  'dallas-fort worth': { latitude: 32.7673, longitude: -96.7776 },
  'dallas fort worth': { latitude: 32.7673, longitude: -96.7776 },
  dfw: { latitude: 32.7673, longitude: -96.7776 },
  'dallas/fort worth': { latitude: 32.7673, longitude: -96.7776 },
  irving: { latitude: 32.814, longitude: -96.9489 },
  frisco: { latitude: 33.1507, longitude: -96.8236 },
  richardson: { latitude: 32.9483, longitude: -96.7299 },
  houston: { latitude: 29.7604, longitude: -95.3698 },
  'san antonio': { latitude: 29.4241, longitude: -98.4936 },
  plano: { latitude: 33.0198, longitude: -96.6989 },

  // ── US — Mountain / Midwest ──
  denver: { latitude: 39.7392, longitude: -104.9903 },
  boulder: { latitude: 40.015, longitude: -105.2705 },
  englewood: { latitude: 39.6478, longitude: -104.9878 },
  'salt lake city': { latitude: 40.7608, longitude: -111.891 },
  lehi: { latitude: 40.3916, longitude: -111.8508 },
  provo: { latitude: 40.2338, longitude: -111.6585 },
  phoenix: { latitude: 33.4484, longitude: -112.074 },
  tempe: { latitude: 33.4255, longitude: -111.94 },
  scottsdale: { latitude: 33.4942, longitude: -111.9261 },
  chandler: { latitude: 33.3062, longitude: -111.8413 },
  chicago: { latitude: 41.8781, longitude: -87.6298 },
  minneapolis: { latitude: 44.9778, longitude: -93.265 },
  detroit: { latitude: 42.3314, longitude: -83.0458 },
  'ann arbor': { latitude: 42.2808, longitude: -83.743 },
  columbus: { latitude: 39.9612, longitude: -82.9988 },
  cincinnati: { latitude: 39.1031, longitude: -84.512 },
  cleveland: { latitude: 41.4993, longitude: -81.6944 },
  indianapolis: { latitude: 39.7684, longitude: -86.1581 },
  milwaukee: { latitude: 43.0389, longitude: -87.9065 },
  madison: { latitude: 43.0731, longitude: -89.4012 },
  'st louis': { latitude: 38.627, longitude: -90.1994 },
  'saint louis': { latitude: 38.627, longitude: -90.1994 },
  'kansas city': { latitude: 39.0997, longitude: -94.5786 },
  omaha: { latitude: 41.2565, longitude: -95.9345 },
  'las vegas': { latitude: 36.1699, longitude: -115.1398 },

  // ── Canada ──
  toronto: { latitude: 43.6532, longitude: -79.3832 },
  vancouver: { latitude: 49.2827, longitude: -123.1207 },
  montreal: { latitude: 45.5019, longitude: -73.5674 },
  waterloo: { latitude: 43.4643, longitude: -80.5204 },
  ottawa: { latitude: 45.4215, longitude: -75.6972 },
  calgary: { latitude: 51.0447, longitude: -114.0719 },
  edmonton: { latitude: 53.5461, longitude: -113.4938 },
  mississauga: { latitude: 43.589, longitude: -79.6441 },
  markham: { latitude: 43.8561, longitude: -79.337 },

  // ── Europe ──
  london: { latitude: 51.5074, longitude: -0.1278 },
  cambridge_uk: { latitude: 52.2053, longitude: 0.1218 },
  edinburgh: { latitude: 55.9533, longitude: -3.1883 },
  manchester: { latitude: 53.4808, longitude: -2.2426 },
  dublin: { latitude: 53.3498, longitude: -6.2603 },
  cork: { latitude: 51.8985, longitude: -8.4756 },
  berlin: { latitude: 52.52, longitude: 13.405 },
  munich: { latitude: 48.1351, longitude: 11.582 },
  frankfurt: { latitude: 50.1109, longitude: 8.6821 },
  hamburg: { latitude: 53.5511, longitude: 9.9937 },
  walldorf: { latitude: 49.3064, longitude: 8.6428 },
  paris: { latitude: 48.8566, longitude: 2.3522 },
  amsterdam: { latitude: 52.3676, longitude: 4.9041 },
  eindhoven: { latitude: 51.4416, longitude: 5.4697 },
  madrid: { latitude: 40.4168, longitude: -3.7038 },
  barcelona: { latitude: 41.3851, longitude: 2.1734 },
  zurich: { latitude: 47.3769, longitude: 8.5417 },
  geneva: { latitude: 46.2044, longitude: 6.1432 },
  stockholm: { latitude: 59.3293, longitude: 18.0686 },
  copenhagen: { latitude: 55.6761, longitude: 12.5683 },
  oslo: { latitude: 59.9139, longitude: 10.7522 },
  helsinki: { latitude: 60.1699, longitude: 24.9384 },
  lisbon: { latitude: 38.7223, longitude: -9.1393 },
  warsaw: { latitude: 52.2297, longitude: 21.0122 },
  krakow: { latitude: 50.0647, longitude: 19.945 },
  prague: { latitude: 50.0755, longitude: 14.4378 },
  vienna: { latitude: 48.2082, longitude: 16.3738 },
  milan: { latitude: 45.4642, longitude: 9.19 },
  rome: { latitude: 41.9028, longitude: 12.4964 },
  brussels: { latitude: 50.8503, longitude: 4.3517 },
  luxembourg: { latitude: 49.6116, longitude: 6.1319 },
  bucharest: { latitude: 44.4268, longitude: 26.1025 },
  budapest: { latitude: 47.4979, longitude: 19.0402 },
  athens: { latitude: 37.9838, longitude: 23.7275 },

  // ── Middle East & Africa ──
  riyadh: { latitude: 24.7136, longitude: 46.6753 },
  jeddah: { latitude: 21.5433, longitude: 39.1728 },
  dubai: { latitude: 25.2048, longitude: 55.2708 },
  'abu dhabi': { latitude: 24.4539, longitude: 54.3773 },
  'tel aviv': { latitude: 32.0853, longitude: 34.7818 },
  haifa: { latitude: 32.794, longitude: 34.9896 },
  amman: { latitude: 31.9454, longitude: 35.9284 },
  cairo: { latitude: 30.0444, longitude: 31.2357 },
  johannesburg: { latitude: -26.2041, longitude: 28.0473 },
  'cape town': { latitude: -33.9249, longitude: 18.4241 },
  nairobi: { latitude: -1.2921, longitude: 36.8219 },
  istanbul: { latitude: 41.0082, longitude: 28.9784 },

  // ── Asia-Pacific ──
  singapore: { latitude: 1.3521, longitude: 103.8198 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  hyderabad: { latitude: 17.385, longitude: 78.4867 },
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  'new delhi': { latitude: 28.6139, longitude: 77.209 },
  delhi: { latitude: 28.6139, longitude: 77.209 },
  gurgaon: { latitude: 28.4595, longitude: 77.0266 },
  gurugram: { latitude: 28.4595, longitude: 77.0266 },
  noida: { latitude: 28.5355, longitude: 77.391 },
  pune: { latitude: 18.5204, longitude: 73.8567 },
  chennai: { latitude: 13.0827, longitude: 80.2707 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
  osaka: { latitude: 34.6937, longitude: 135.5023 },
  'hong kong': { latitude: 22.3193, longitude: 114.1694 },
  shanghai: { latitude: 31.2304, longitude: 121.4737 },
  beijing: { latitude: 39.9042, longitude: 116.4074 },
  shenzhen: { latitude: 22.5431, longitude: 114.0579 },
  hangzhou: { latitude: 30.2741, longitude: 120.1551 },
  guangzhou: { latitude: 23.1291, longitude: 113.2644 },
  chengdu: { latitude: 30.5728, longitude: 104.0668 },
  suzhou: { latitude: 31.2989, longitude: 120.5853 },
  taipei: { latitude: 25.033, longitude: 121.5654 },
  hsinchu: { latitude: 24.8138, longitude: 120.9675 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
  melbourne: { latitude: -37.8136, longitude: 144.9631 },
  brisbane: { latitude: -27.4705, longitude: 153.026 },
  auckland: { latitude: -36.8485, longitude: 174.7633 },
  bangkok: { latitude: 13.7563, longitude: 100.5018 },
  seoul: { latitude: 37.5665, longitude: 126.978 },
  manila: { latitude: 14.5995, longitude: 120.9842 },
  jakarta: { latitude: -6.2088, longitude: 106.8456 },
  'kuala lumpur': { latitude: 3.139, longitude: 101.6869 },
  'ho chi minh city': { latitude: 10.8231, longitude: 106.6297 },
  hanoi: { latitude: 21.0285, longitude: 105.8542 },

  // ── Latin America ──
  'sao paulo': { latitude: -23.5505, longitude: -46.6333 },
  'nova santa rita': { latitude: -29.8569, longitude: -51.2731 },
  'porto alegre': { latitude: -30.0346, longitude: -51.2177 },
  'rio de janeiro': { latitude: -22.9068, longitude: -43.1729 },
  curitiba: { latitude: -25.4284, longitude: -49.2733 },
  'belo horizonte': { latitude: -19.9167, longitude: -43.9345 },
  'mexico city': { latitude: 19.4326, longitude: -99.1332 },
  guadalajara: { latitude: 20.6597, longitude: -103.3496 },
  monterrey: { latitude: 25.6866, longitude: -100.3161 },
  bogota: { latitude: 4.711, longitude: -74.0721 },
  'buenos aires': { latitude: -34.6037, longitude: -58.3816 },
  santiago: { latitude: -33.4489, longitude: -70.6693 },
  lima: { latitude: -12.0464, longitude: -77.0428 },
  'san jose cr': { latitude: 9.9281, longitude: -84.0907 },
};

// US States + Canadian Provinces + Major Global Regions
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
  'district of columbia': { abbr: 'DC', latitude: 38.9072, longitude: -77.0369 },
  florida: { abbr: 'FL', latitude: 27.7663, longitude: -81.6868 },
  georgia: { abbr: 'GA', latitude: 33.0406, longitude: -83.6431 },
  hawaii: { abbr: 'HI', latitude: 19.8968, longitude: -155.5828 },
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

  // Canadian Provinces & Brazilian States commonly in ATS feeds
  ontario: { abbr: 'ON', latitude: 43.6532, longitude: -79.3832 },
  'british columbia': { abbr: 'BC', latitude: 49.2827, longitude: -123.1207 },
  quebec: { abbr: 'QC', latitude: 45.5019, longitude: -73.5674 },
  alberta: { abbr: 'AB', latitude: 51.0447, longitude: -114.0719 },
  'rio grande do sul': { abbr: 'RS', latitude: -30.0346, longitude: -51.2177 },
};

// Country-level fallbacks for international roles where city isn't in CITIES
const COUNTRIES: Record<string, { label: string; latitude: number; longitude: number }> = {
  canada: { label: 'Toronto, Canada', latitude: 43.6532, longitude: -79.3832 },
  uk: { label: 'London, UK', latitude: 51.5074, longitude: -0.1278 },
  'united kingdom': { label: 'London, UK', latitude: 51.5074, longitude: -0.1278 },
  ireland: { label: 'Dublin, Ireland', latitude: 53.3498, longitude: -6.2603 },
  germany: { label: 'Berlin, Germany', latitude: 52.52, longitude: 13.405 },
  france: { label: 'Paris, France', latitude: 48.8566, longitude: 2.3522 },
  netherlands: { label: 'Amsterdam, Netherlands', latitude: 52.3676, longitude: 4.9041 },
  spain: { label: 'Madrid, Spain', latitude: 40.4168, longitude: -3.7038 },
  switzerland: { label: 'Zurich, Switzerland', latitude: 47.3769, longitude: 8.5417 },
  sweden: { label: 'Stockholm, Sweden', latitude: 59.3293, longitude: 18.0686 },
  poland: { label: 'Warsaw, Poland', latitude: 52.2297, longitude: 21.0122 },
  india: { label: 'Bengaluru, India', latitude: 12.9716, longitude: 77.5946 },
  china: { label: 'Shanghai, China', latitude: 31.2304, longitude: 121.4737 },
  japan: { label: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503 },
  'south korea': { label: 'Seoul, South Korea', latitude: 37.5665, longitude: 126.978 },
  korea: { label: 'Seoul, South Korea', latitude: 37.5665, longitude: 126.978 },
  australia: { label: 'Sydney, Australia', latitude: -33.8688, longitude: 151.2093 },
  brazil: { label: 'São Paulo, Brazil', latitude: -23.5505, longitude: -46.6333 },
  mexico: { label: 'Mexico City, Mexico', latitude: 19.4326, longitude: -99.1332 },
  'saudi arabia': { label: 'Riyadh, Saudi Arabia', latitude: 24.7136, longitude: 46.6753 },
  uae: { label: 'Dubai, UAE', latitude: 25.2048, longitude: 55.2708 },
  'united arab emirates': { label: 'Dubai, UAE', latitude: 25.2048, longitude: 55.2708 },
  israel: { label: 'Tel Aviv, Israel', latitude: 32.0853, longitude: 34.7818 },
};

/** ISO-2 / common ATS country codes → COUNTRIES keys (e.g. "Gdansk, PL"). */
const ISO_TO_COUNTRY: Record<string, string> = {
  pl: 'poland',
  au: 'australia',
  gb: 'united kingdom',
  uk: 'united kingdom',
  de: 'germany',
  fr: 'france',
  nl: 'netherlands',
  es: 'spain',
  ch: 'switzerland',
  se: 'sweden',
  in: 'india',
  cn: 'china',
  jp: 'japan',
  kr: 'south korea',
  br: 'brazil',
  mx: 'mexico',
  sa: 'saudi arabia',
  ae: 'uae',
  il: 'israel',
  ie: 'ireland',
  ca: 'canada',
};

function lookupCountry(token: string): { label: string; latitude: number; longitude: number } | null {
  const key = norm(token);
  if (COUNTRIES[key]) return COUNTRIES[key];
  const mapped = ISO_TO_COUNTRY[key];
  if (mapped && COUNTRIES[mapped]) return COUNTRIES[mapped];
  return null;
}

// Abbreviation → state info.
const STATE_BY_ABBR: Record<string, StateInfo> = {};
for (const info of Object.values(STATES)) STATE_BY_ABBR[info.abbr.toLowerCase()] = info;

/**
 * Whether a token is unambiguously a state qualifier (not also a city), used to
 * decide if a comma chunk is "City, State" vs a multi-city list.
 */
function isUnambiguousStateQualifier(token: string): boolean {
  const key = norm(token);
  if (STATE_BY_ABBR[key]) return true;
  if (CITIES[key]) return false;
  return Boolean(STATES[key] || lookupCountry(token));
}

/** Map a free-form state token (name or abbr) to its info, or null. */
function lookupState(token: string): StateInfo | null {
  const key = norm(token);
  if (STATES[key]) return STATES[key];
  if (key === 'new york') return STATES['new york state'];
  if (key === 'washington') return STATES['washington_state'];
  if (STATE_BY_ABBR[key]) return STATE_BY_ABBR[key];
  return null;
}

/** Resolve a single city token to coordinates, or null if unknown. */
export function lookupCity(raw: string | null | undefined): CityCoord | null {
  if (!raw) return null;
  const cleaned = cleanLocationChunk(raw);
  const whole = norm(cleaned);
  if (CITIES[whole]) return CITIES[whole];
  const firstSegment = norm(cleaned.split(',')[0] ?? '');
  if (firstSegment && CITIES[firstSegment]) return CITIES[firstSegment];
  for (const seg of cleaned.split(',')) {
    const key = norm(seg);
    if (CITIES[key]) return CITIES[key];
  }
  return null;
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  if (w.length <= 2 && !w.includes('-')) return w.toUpperCase();
  return w
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join('-');
}

function titleCase(s: string): string {
  return s.trim().split(' ').map(titleCaseWord).join(' ');
}

const US_STATE_ABBRS = new Set(Object.keys(STATE_BY_ABBR));

/**
 * Resolve a single "City, State" (or "City, Country") chunk to a place.
 * Tries the exact city first, then state center, then country center.
 */
function resolveChunk(rawChunk: string): ResolvedPlace | null {
  const chunk = cleanLocationChunk(rawChunk);
  const segments = chunk.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  const cityPart = segments[0];
  const statePart = segments[1];
  const stateInfo = statePart ? lookupState(statePart) : null;
  const stateAbbr =
    stateInfo?.abbr ??
    (statePart && US_STATE_ABBRS.has(norm(statePart)) ? statePart.toUpperCase() : null);

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

  // 2) State-center fallback (city unknown but we recognize the state/province).
  if (stateInfo) {
    return {
      latitude: stateInfo.latitude,
      longitude: stateInfo.longitude,
      label: `${titleCase(cityPart)}, ${stateInfo.abbr}`,
      city: titleCase(cityPart),
      state: stateInfo.abbr,
    };
  }

  // 3) The first segment itself might BE a state (e.g. "Texas").
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

  // 4) Country-level fallback if any segment matches a known country or ISO code.
  for (const seg of segments) {
    const country = lookupCountry(seg);
    if (country) {
      return {
        latitude: country.latitude,
        longitude: country.longitude,
        label: segments.length > 1 ? `${titleCase(cityPart)}, ${titleCase(seg)}` : country.label,
        city: titleCase(cityPart),
        state: null,
      };
    }
  }

  return null;
}

// Tokens that mean "no physical location" → should fall back to HQ.
const NON_PHYSICAL =
  /^(remote|anywhere|united states|usa|us|u\.s\.|work from home|wfh|global|multiple locations|various locations)$/i;

export function isRemoteLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  return /\bremote\b|\banywhere\b|\bwork from home\b|\bwfh\b/i.test(location);
}

/**
 * Normalize a longitude into the canonical [-180, 180) range.
 */
export function normalizeLongitude(lng: number): number {
  if (!Number.isFinite(lng)) return lng;
  if (lng >= -180 && lng < 180) return lng;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Resolve ALL distinct places from a (possibly multi-city) location string.
 */
export function resolveAllRoleCoords(location: string | null | undefined): ResolvedPlace[] {
  if (!location) return [];
  const trimmed = location.trim();
  if (NON_PHYSICAL.test(trimmed)) return [];

  const rawChunks = trimmed
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
    const segs = chunk.split(',').map((s) => s.trim()).filter(Boolean);
    // Country suffixes must not hide a list such as "New York, Seattle, USA".
    const cityParts = segs.filter((segment, index) => index === 0 ||
      (!/^(usa?|united states|u\.s\.)$/i.test(segment) && !lookupCountry(segment)));
    if (cityParts.length >= 2 && cityParts.every(part => lookupCity(part)) &&
        !cityParts.some(part => isUnambiguousStateQualifier(part))) {
      cityParts.forEach(pushChunk);
      continue;
    }
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
 * Back-compat single-result resolver (first recognized place).
 */
export function resolveRoleCoords(
  location: string | null | undefined
): { latitude: number; longitude: number; city: string } | null {
  const all = resolveAllRoleCoords(location);
  if (all.length === 0) return null;
  const first = all[0];
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    city: first.city ?? first.label,
  };
}
