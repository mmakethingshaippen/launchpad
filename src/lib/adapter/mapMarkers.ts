import type { MapMarker, MapMarkerRole } from './adapter';
import type { Season } from './types';
import {
  normalizeLongitude,
  resolveAllRoleCoords,
  type ResolvedPlace,
} from '../ats/cityCoords';

export type { MapMarker, MapMarkerRole };

export interface MapRoleInput {
  id: string;
  slug: string;
  title: string;
  companyId?: string;
  companyName: string;
  companySlug?: string;
  companyLogoUrl?: string | null;
  companyWebsiteUrl?: string | null;
  seasons: Array<Season | string>;
  cohortYear?: number | null;
  locationString?: string | null;
  location?: string | null;
  locationCity?: string | null;
  locationState?: string | null;
  workArrangement?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  hqCity?: string | null;
  hqState?: string | null;
  hqLatitude?: number | null;
  hqLongitude?: number | null;
  companyHqCity?: string | null;
  companyHqState?: string | null;
  companyLatitude?: number | null;
  companyLongitude?: number | null;
}

const COMPANY_HUB_FALLBACKS: Record<string, ResolvedPlace> = {
  amazon: { city: 'Seattle', state: 'WA', latitude: 47.6062, longitude: -122.3321, label: 'Seattle, WA' },
  bechtel: { city: 'Reston', state: 'VA', latitude: 38.9586, longitude: -77.357, label: 'Reston, VA' },
  anthropic: { city: 'San Francisco', state: 'CA', latitude: 37.7749, longitude: -122.4194, label: 'San Francisco, CA' },
  airbnb: { city: 'San Francisco', state: 'CA', latitude: 37.7749, longitude: -122.4194, label: 'San Francisco, CA' },
  google: { city: 'Mountain View', state: 'CA', latitude: 37.3861, longitude: -122.0839, label: 'Mountain View, CA' },
  waymo: { city: 'Mountain View', state: 'CA', latitude: 37.3861, longitude: -122.0839, label: 'Mountain View, CA' },
  apple: { city: 'Cupertino', state: 'CA', latitude: 37.323, longitude: -122.0322, label: 'Cupertino, CA' },
  meta: { city: 'Menlo Park', state: 'CA', latitude: 37.453, longitude: -122.1817, label: 'Menlo Park, CA' },
  microsoft: { city: 'Redmond', state: 'WA', latitude: 47.674, longitude: -122.1215, label: 'Redmond, WA' },
  nvidia: { city: 'Santa Clara', state: 'CA', latitude: 37.3541, longitude: -121.9552, label: 'Santa Clara, CA' },
  stripe: { city: 'South San Francisco', state: 'CA', latitude: 37.6547, longitude: -122.4077, label: 'South San Francisco, CA' },
  paypal: { city: 'San Jose', state: 'CA', latitude: 37.3382, longitude: -121.8863, label: 'San Jose, CA' },
  'applied materials': { city: 'Santa Clara', state: 'CA', latitude: 37.3541, longitude: -121.9552, label: 'Santa Clara, CA' },
};

function getRoleLocationString(role: MapRoleInput): string {
  if (role.locationString && role.locationString.trim()) {
    return role.locationString.trim();
  }
  if (role.location && role.location.trim()) {
    return role.location.trim();
  }
  return [role.locationCity?.trim(), role.locationState?.trim()]
    .filter(Boolean)
    .join(', ');
}

function getHqCity(role: MapRoleInput): string {
  return role.hqCity?.trim() || role.companyHqCity?.trim() || '';
}

function getHqState(role: MapRoleInput): string {
  return role.hqState?.trim() || role.companyHqState?.trim() || '';
}

function getHqLocationString(role: MapRoleInput): string {
  return [getHqCity(role), getHqState(role)].filter(Boolean).join(', ');
}

function fallbackPlaceForRole(role: MapRoleInput): ResolvedPlace {
  const hqCity = getHqCity(role);
  const hqState = getHqState(role);
  const hqLat = role.hqLatitude ?? role.companyLatitude;
  const hqLng = role.hqLongitude ?? role.companyLongitude;

  // 1. Explicit role coordinates
  if (
    typeof role.latitude === 'number' &&
    Number.isFinite(role.latitude) &&
    typeof role.longitude === 'number' &&
    Number.isFinite(role.longitude)
  ) {
    const city = role.locationCity?.trim() || hqCity || 'Job Location';
    const state = role.locationState?.trim() || hqState || '';
    const label = [city, state].filter(Boolean).join(', ') || role.companyName || 'Location';
    return {
      city,
      state,
      latitude: role.latitude,
      longitude: normalizeLongitude(role.longitude),
      label,
    };
  }

  // 2. Explicit company HQ coordinates
  if (
    typeof hqLat === 'number' &&
    Number.isFinite(hqLat) &&
    typeof hqLng === 'number' &&
    Number.isFinite(hqLng)
  ) {
    const city = hqCity || role.locationCity?.trim() || 'Headquarters';
    const state = hqState || role.locationState?.trim() || '';
    const label = [city, state].filter(Boolean).join(', ') || `${role.companyName} HQ`;
    return {
      city,
      state,
      latitude: hqLat,
      longitude: normalizeLongitude(hqLng),
      label,
    };
  }

  // 3. Try resolving Company HQ string through cityCoords
  const hqString = getHqLocationString(role);
  if (hqString) {
    const hqPlaces = resolveAllRoleCoords(hqString);
    if (hqPlaces.length > 0) {
      return hqPlaces[0];
    }
  }

  // 4. Known major company HQ hubs — lenient matching
  const normCompany = (role.companyName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(corporation|corp|inc|incorporated|llc|ltd|limited|company|co|pbc|plc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [key, hub] of Object.entries(COMPANY_HUB_FALLBACKS)) {
    if (
      normCompany === key ||
      normCompany.includes(key) ||
      key.includes(normCompany) ||
      normCompany.startsWith(key) ||
      key.startsWith(normCompany)
    ) {
      return hub;
    }
  }

  // 5. Ultimate fallback so no role is ever silently discarded from the map
  const fallbackCity = role.locationCity?.trim() || hqCity || 'San Francisco';
  const fallbackState = role.locationState?.trim() || hqState || 'CA';
  const fallbackLabel =
    getRoleLocationString(role) ||
    [fallbackCity, fallbackState].filter(Boolean).join(', ') ||
    'United States';

  return {
    city: fallbackCity,
    state: fallbackState,
    latitude: 37.7749,
    longitude: -122.4194,
    label: fallbackLabel,
  };
}

/**
 * Group roles into geographic map markers by resolved place.
 * Prefers stored role lat/lng when available.
 */
export function buildMapMarkers(roles: MapRoleInput[]): MapMarker[] {
  const groups = new Map<
    string,
    {
      place: ResolvedPlace;
      roles: Map<string, MapMarkerRole>;
      companies: Set<string>;
    }
  >();

  for (const role of roles) {
    let places: ResolvedPlace[] = [];

    // Prefer explicit stored coordinates on the role
    if (
      typeof role.latitude === 'number' &&
      Number.isFinite(role.latitude) &&
      typeof role.longitude === 'number' &&
      Number.isFinite(role.longitude)
    ) {
      const city = role.locationCity?.trim() || role.hqCity?.trim() || 'Job Location';
      const state = role.locationState?.trim() || role.hqState?.trim() || '';
      const label = [city, state].filter(Boolean).join(', ') || role.companyName || 'Location';
      places = [{
        city,
        state,
        latitude: role.latitude,
        longitude: normalizeLongitude(role.longitude),
        label,
      }];
    } else {
      const locString = getRoleLocationString(role);
      places = locString ? resolveAllRoleCoords(locString) : [];
      if (places.length === 0) {
        places = [fallbackPlaceForRole(role)];
      }
    }

    for (const place of places) {
      const latitude = place.latitude;
      const longitude = normalizeLongitude(place.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      const key = `${place.label.toLowerCase()}|${latitude.toFixed(3)}|${longitude.toFixed(3)}`;
      let group = groups.get(key);

      if (!group) {
        const newGroup = {
          place: { ...place, latitude, longitude },
          roles: new Map<string, MapMarkerRole>(),
          companies: new Set<string>(),
        };
        groups.set(key, newGroup);
        group = newGroup;
      }

      if (!group.roles.has(role.id)) {
        group.roles.set(role.id, {
          id: role.id,
          slug: role.slug,
          title: role.title,
          companyName: role.companyName,
          companySlug: role.companySlug ?? '',
          companyLogoUrl: role.companyLogoUrl ?? null,
          companyWebsiteUrl: role.companyWebsiteUrl ?? null,
          seasons: (role.seasons ?? []) as Season[],
          cohortYear: role.cohortYear ?? null,
        });
      }

      const companyKey = (role.companyId || role.companyName || '').trim().toLowerCase();
      if (companyKey) {
        group.companies.add(companyKey);
      }
    }
  }

  const markers: MapMarker[] = [];
  for (const [key, group] of groups.entries()) {
    const roleList = Array.from(group.roles.values());
    if (roleList.length === 0) continue;

    markers.push({
      id: key,
      label: group.place.label,
      city: group.place.city || null,
      state: group.place.state || null,
      latitude: group.place.latitude,
      longitude: group.place.longitude,
      roleCount: roleList.length,
      companyCount: Math.max(group.companies.size, 1),
      roles: roleList,
    });
  }

  return markers.sort((a, b) => b.roleCount - a.roleCount);
}