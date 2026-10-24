/**
 * Canonical location formatting across Launchpad.
 *
 * Rules:
 * - US locations: "City, State" (e.g. "San Francisco, CA", "Austin, TX", "Mountain View, CA")
 *   Never appends "USA", "US", or "United States" to a US city/state location.
 * - International locations: "City, Full Country Name" (e.g. "Penang, Malaysia", "Treviso, Italy")
 *   If city and country are identical (e.g. "Singapore, Singapore"), collapses to "Singapore".
 * - Converts ISO 3-letter (SGP, MYS, ITA, CRI, DEU, etc.) & 2-letter codes to full country names.
 * - Guard: No location ever ends in a 3-letter country code or redundant "USA".
 */

export const US_STATE_ABBRS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU',
]);

export const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'puerto rico': 'PR',
};

export const MAJOR_US_CITIES: Record<string, string> = {
  'san francisco': 'CA',
  'south san francisco': 'CA',
  'san jose': 'CA',
  'palo alto': 'CA',
  'mountain view': 'CA',
  'sunnyvale': 'CA',
  'santa clara': 'CA',
  'cupertino': 'CA',
  'oakland': 'CA',
  'berkeley': 'CA',
  'redwood city': 'CA',
  'menlo park': 'CA',
  'foster city': 'CA',
  'san mateo': 'CA',
  'los angeles': 'CA',
  'san diego': 'CA',
  'long beach': 'CA',
  'irvine': 'CA',
  'pasadena': 'CA',
  'sacramento': 'CA',
  'seattle': 'WA',
  'bellevue': 'WA',
  'redmond': 'WA',
  'new york': 'NY',
  'new york city': 'NY',
  'nyc': 'NY',
  'brooklyn': 'NY',
  'austin': 'TX',
  'dallas': 'TX',
  'dallas-fort worth': 'TX',
  'houston': 'TX',
  'chicago': 'IL',
  'boston': 'MA',
  'cambridge': 'MA',
  'somerville': 'MA',
  'atlanta': 'GA',
  'denver': 'CO',
  'boulder': 'CO',
  'salt lake city': 'UT',
  'phoenix': 'AZ',
  'tempe': 'AZ',
  'pittsburgh': 'PA',
  'philadelphia': 'PA',
  'portland': 'OR',
  'minneapolis': 'MN',
  'honolulu': 'HI',
  'reston': 'VA',
  'mclean': 'VA',
  'arlington': 'VA',
  'washington': 'DC',
};

export const ISO_COUNTRY_NAMES: Record<string, string> = {
  AFG: 'Afghanistan', ALB: 'Albania', DZA: 'Algeria', AND: 'Andorra', AGO: 'Angola',
  ARG: 'Argentina', ARM: 'Armenia', AUS: 'Australia', AUT: 'Austria', AZE: 'Azerbaijan',
  BHR: 'Bahrain', BGD: 'Bangladesh', BLR: 'Belarus', BEL: 'Belgium', BLZ: 'Belize',
  BEN: 'Benin', BOL: 'Bolivia', BIH: 'Bosnia and Herzegovina', BWA: 'Botswana',
  BRA: 'Brazil', BRN: 'Brunei', BGR: 'Bulgaria', BFA: 'Burkina Faso', BDI: 'Burundi',
  KHM: 'Cambodia', CMR: 'Cameroon', CAN: 'Canada', CPV: 'Cape Verde',
  CHL: 'Chile', CHN: 'China', COL: 'Colombia', COG: 'Congo', CRI: 'Costa Rica',
  CIV: "Côte d'Ivoire", HRV: 'Croatia', CUB: 'Cuba', CYP: 'Cyprus', CZE: 'Czech Republic',
  DNK: 'Denmark', DOM: 'Dominican Republic', ECU: 'Ecuador', EGY: 'Egypt', SLV: 'El Salvador',
  EST: 'Estonia', ETH: 'Ethiopia', FIN: 'Finland', FRA: 'France', GEO: 'Georgia',
  DEU: 'Germany', GHA: 'Ghana', GRC: 'Greece', GTM: 'Guatemala', HND: 'Honduras',
  HKG: 'Hong Kong', HUN: 'Hungary', ISL: 'Iceland', IND: 'India', IDN: 'Indonesia',
  IRN: 'Iran', IRQ: 'Iraq', IRL: 'Ireland', ISR: 'Israel', ITA: 'Italy',
  JAM: 'Jamaica', JPN: 'Japan', JOR: 'Jordan', KAZ: 'Kazakhstan', KEN: 'Kenya',
  KOR: 'South Korea', KWT: 'Kuwait', LBN: 'Lebanon', LBY: 'Libya', LTU: 'Lithuania',
  LUX: 'Luxembourg', MYS: 'Malaysia', MEX: 'Mexico', MDA: 'Moldova', MCO: 'Monaco',
  MNG: 'Mongolia', MNE: 'Montenegro', MAR: 'Morocco', MOZ: 'Mozambique', MMR: 'Myanmar',
  NPL: 'Nepal', NLD: 'Netherlands', NZL: 'New Zealand', NIC: 'Nicaragua', NGA: 'Nigeria',
  NOR: 'Norway', OMN: 'Oman', PAK: 'Pakistan', PAN: 'Panama', PER: 'Peru',
  PHL: 'Philippines', POL: 'Poland', PRT: 'Portugal', QAT: 'Qatar', ROU: 'Romania',
  RUS: 'Russia', RWA: 'Rwanda', SAU: 'Saudi Arabia', SEN: 'Senegal', SRB: 'Serbia',
  SGP: 'Singapore', SVK: 'Slovakia', SVN: 'Slovenia', ZAF: 'South Africa', ESP: 'Spain',
  LKA: 'Sri Lanka', SWE: 'Sweden', CHE: 'Switzerland', TWN: 'Taiwan', TZA: 'Tanzania',
  THA: 'Thailand', TUN: 'Tunisia', TUR: 'Turkey', UGA: 'Uganda', UKR: 'Ukraine',
  ARE: 'United Arab Emirates', GBR: 'United Kingdom', USA: 'United States', URY: 'Uruguay',
  UZB: 'Uzbekistan', VEN: 'Venezuela', VNM: 'Vietnam', ZWE: 'Zimbabwe',
  // Common 2-letter codes (excluding US state collisions like CA)
  SG: 'Singapore', MY: 'Malaysia', IT: 'Italy', CR: 'Costa Rica', DE: 'Germany',
  FR: 'France', ES: 'Spain', NL: 'Netherlands', SE: 'Sweden', JP: 'Japan',
  KR: 'South Korea', GB: 'United Kingdom', UK: 'United Kingdom', AU: 'Australia',
  BR: 'Brazil', MX: 'Mexico', IN: 'India', IL: 'Israel', PL: 'Poland',
  // ATS noise codes like "WAR" (Warsaw/Poland), "VIC" (Victoria/Australia), "NSW" (New South Wales)
  WAR: 'Poland', VIC: 'Australia', NSW: 'Australia', GLS: 'United Kingdom',
  GRO: 'Netherlands', NLE: 'Netherlands', DIF: 'Mexico', YUC: 'Mexico',
};

/** Convert any ISO code or country token to full country name. */
export function resolveCountryName(token: string | null | undefined): string | null {
  if (!token) return null;
  const t = token.trim();
  const upper = t.toUpperCase();
  if (ISO_COUNTRY_NAMES[upper]) return ISO_COUNTRY_NAMES[upper];
  if (/^(usa?|united states|u\.s\.a?)$/i.test(t)) return 'United States';
  if (/^(united kingdom|u\.k\.)$/i.test(t)) return 'United Kingdom';
  return t;
}

export interface LocationInput {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  workArrangement?: string | null;
}

/**
 * Format a location for display.
 */
export function formatLocation(loc: LocationInput): string {
  if (loc.workArrangement === 'Remote') return 'Remote';

  let city = (loc.city ?? '').trim();
  let state = (loc.state ?? '').trim();
  let country = (loc.country ?? '').trim();

  // Multi-location semicolon delimiter cleanup: take primary location segment
  if (city.includes(';')) city = city.split(';')[0].trim();
  if (state.includes(';')) state = state.split(';')[0].trim();
  if (country.includes(';')) country = country.split(';')[0].trim();

  // Clean trailing punctuation or noise
  city = city.replace(/[;,]+$/, '').trim();
  state = state.replace(/[;,]+$/, '').trim();
  country = country.replace(/[;,]+$/, '').trim();

  // Normalize composite state strings from ATS like "CA USA", "CA, USA", "California USA"
  const stateUsaMatch = state.match(/^([A-Za-z\s]+?)[,;\s]+(?:USA|US|United States)$/i);
  if (stateUsaMatch) {
    state = stateUsaMatch[1].trim();
    if (!country) country = 'United States';
  }

  // Normalize composite country strings like "CA USA", "TX USA", or "USA"
  const countryStateMatch = country.match(/^([A-Z]{2})\s+(?:USA|US)$/i);
  if (countryStateMatch) {
    if (!state) state = countryStateMatch[1];
    country = 'United States';
  }

  // Normalize composite city strings like "Mountain View, CA USA" or "San Francisco, CA"
  const cityCompositeMatch = city.match(/^(.*?)[,;\s]+([A-Z]{2})[,;\s]*(?:USA|US|United States)?$/i);
  if (cityCompositeMatch && !state) {
    city = cityCompositeMatch[1].trim();
    state = cityCompositeMatch[2].trim();
  } else if (/[,;\s]+(?:USA|US|United States)$/i.test(city)) {
    city = city.replace(/[,;\s]+(?:USA|US|United States)$/i, '').trim();
  }

  const cityNorm = city.toLowerCase().replace(/ - [a-z0-9]+$/i, '').trim();

  // If state is a 3-letter foreign country code (e.g. SGP, MYS, ITA, CRI, DEU)
  const stateUpper = state.toUpperCase();
  if (state.length === 3 && ISO_COUNTRY_NAMES[stateUpper] && !US_STATE_ABBRS.has(stateUpper)) {
    if (!country) country = ISO_COUNTRY_NAMES[stateUpper];
    state = '';
  }

  // If country is a 3-letter code
  const countryUpper = country.toUpperCase();
  if (ISO_COUNTRY_NAMES[countryUpper]) {
    country = ISO_COUNTRY_NAMES[countryUpper];
  } else if (/^(usa?|united states|u\.s\.a?)$/i.test(country)) {
    country = 'United States';
  }

  // Check for US state in state field
  let usStateAbbr: string | null = null;
  if (state) {
    if (US_STATE_ABBRS.has(stateUpper)) {
      usStateAbbr = stateUpper;
    } else {
      const lower = state.toLowerCase();
      if (US_STATE_NAMES[lower]) {
        usStateAbbr = US_STATE_NAMES[lower];
      }
    }
  }

  // Major US city detection: if city is a known US city and no foreign country is explicitly set
  const isUSCountry = !country || country === 'United States' || /^(usa?|united states|u\.s\.a?)$/i.test(country);
  if (MAJOR_US_CITIES[cityNorm] && isUSCountry) {
    usStateAbbr = usStateAbbr ?? MAJOR_US_CITIES[cityNorm];
    country = '';
  }

  let label: string;
  if (usStateAbbr) {
    // US location: "City, State" (never append USA or country code)
    label = city ? `${city}, ${usStateAbbr}` : usStateAbbr;
  } else if (country && country !== 'United States') {
    // International location: "City, Country"
    if (city && country) {
      if (city.toLowerCase() === country.toLowerCase()) {
        label = city; // e.g. "Singapore" rather than "Singapore, Singapore"
      } else {
        label = `${city}, ${country}`;
      }
    } else {
      label = city || country || 'Location N/A';
    }
  } else if (city) {
    label = state ? `${city}, ${state}` : city;
  } else {
    label = country || 'Location N/A';
  }

  // Strip redundant trailing USA / US / United States on US locations
  label = label.replace(/,\s*([A-Z]{2})[,\s]+(?:USA|US|United States|U\.S\.A\.)\b/gi, ', $1');
  label = label.replace(/,\s*(?:USA|U\.S\.A\.)\s*$/i, '');
  label = label.replace(/\s+(?:USA|U\.S\.A\.)\s*$/i, '');

  // Guard: Replace any trailing 3-letter uppercase country code (e.g. ", CRI" -> ", Costa Rica")
  label = label.replace(/,\s*([A-Z]{3})\b/g, (_, code: string) => {
    const full = ISO_COUNTRY_NAMES[code];
    return full ? `, ${full}` : `, ${code}`;
  });

  return loc.workArrangement === 'Hybrid' ? `${label} · Hybrid` : label;
}
