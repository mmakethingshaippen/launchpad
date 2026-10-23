import type { MapData, MapMarker, MapMarkerRole } from './adapter';
import type { Season } from './types';
import { logoForCompany } from '../logo';
import {
  isRemoteLocation,
  normalizeLongitude,
  resolveAllRoleCoords,
  type ResolvedPlace,
} from '../ats/cityCoords';

export type { MapData, MapMarker, MapMarkerRole };

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

function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) &&
    Math.abs(latitude) <= 85 && typeof longitude === 'number' && Number.isFinite(longitude);
}

function locationString(role: MapRoleInput): string {
  return role.locationString?.trim() || role.location?.trim() ||
    [role.locationCity, role.locationState].filter(Boolean).join(', ');
}

function markerRole(role: MapRoleInput): MapMarkerRole {
  return {
    id: role.id,
    slug: role.slug,
    title: role.title,
    companyName: role.companyName,
    companySlug: role.companySlug ?? '',
    companyLogoUrl: logoForCompany({ logoUrl: role.companyLogoUrl, websiteUrl: role.companyWebsiteUrl }),
    companyWebsiteUrl: role.companyWebsiteUrl ?? null,
    seasons: role.seasons ?? [],
    cohortYear: role.cohortYear ?? null,
  };
}

function hqPlace(role: MapRoleInput): ResolvedPlace | null {
  const city = role.hqCity?.trim() || role.companyHqCity?.trim() || null;
  const state = role.hqState?.trim() || role.companyHqState?.trim() || null;
  const latitude = role.hqLatitude ?? role.companyLatitude;
  const longitude = role.hqLongitude ?? role.companyLongitude;
  const label = [city, state].filter(Boolean).join(', ') || `${role.companyName} headquarters`;
  if (validCoordinates(latitude, longitude)) {
    return { city, state, label, latitude: latitude!, longitude: normalizeLongitude(longitude!) };
  }
  return city ? resolveAllRoleCoords([city, state].filter(Boolean).join(', '))[0] ?? null : null;
}

/** Keep every public role in either a real marker or the explicit unlocated list. */
export function buildMapData(roles: MapRoleInput[]): MapData {
  const groups = new Map<string, { marker: MapMarker; roles: Map<string, MapMarkerRole>; companies: Set<string> }>();
  const unmapped = new Map<string, MapMarkerRole>();
  const mappedIds = new Set<string>();

  for (const role of roles) {
    const text = locationString(role);
    const remote = role.workArrangement === 'Remote' || isRemoteLocation(text);
    // A stored coordinate represents only ONE office. Preserve all named offices.
    let places = resolveAllRoleCoords(text);
    let kind: 'job' | 'hq' = 'job';
    if (places.length === 0 && !remote && validCoordinates(role.latitude, role.longitude)) {
      places = [{
        latitude: role.latitude!, longitude: normalizeLongitude(role.longitude!),
        city: role.locationCity?.trim() || null,
        state: role.locationState?.trim() || null,
        label: text || 'Job location',
      }];
    }
    if (places.length === 0) {
      const hq = hqPlace(role);
      if (hq) {
        kind = 'hq';
        places = [{ ...hq, label: `${hq.label}${remote ? ' (Remote)' : ''}` }];
      }
    }

    const item = markerRole(role);
    let plotted = false;
    for (const place of places) {
      if (!validCoordinates(place.latitude, place.longitude)) continue;
      const longitude = normalizeLongitude(place.longitude);
      const key = `${place.latitude.toFixed(4)}|${longitude.toFixed(4)}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          marker: {
            id: key, label: place.label, city: place.city, state: place.state,
            latitude: place.latitude, longitude, roleCount: 0, companyCount: 0,
            roles: [], locationKind: kind,
          },
          roles: new Map(), companies: new Set(),
        };
        groups.set(key, group);
      }
      // One clickable pin per coordinate, including co-located HQ fallbacks.
      if (kind === 'job') {
        group.marker.locationKind = 'job';
        group.marker.label = place.label;
        group.marker.city = place.city;
        group.marker.state = place.state;
      }
      group.roles.set(role.id, { ...item, locationKind: kind,
        locationLabel: place.label, locationCity: place.city, locationState: place.state });
      group.companies.add(role.companyId || role.companySlug || role.companyName.trim().toLowerCase());
      mappedIds.add(role.id);
      plotted = true;
    }
    if (!plotted) unmapped.set(role.id, item);
  }

  const markers = [...groups.values()].map(({ marker, roles: items, companies }) => ({
    ...marker, roles: [...items.values()], roleCount: items.size, companyCount: companies.size,
  })).sort((a, b) => b.roleCount - a.roleCount || a.id.localeCompare(b.id));
  return { markers, unmappedRoles: [...unmapped.values()].filter(role => !mappedIds.has(role.id)) };
}

export function buildMapMarkers(roles: MapRoleInput[]): MapMarker[] {
  return buildMapData(roles).markers;
}
