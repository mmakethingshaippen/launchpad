import type { MapCompany } from './adapter';
import { logoForCompany } from '../logo';
import { resolveRoleCoords, isRemoteLocation } from '../ats/cityCoords';

/**
 * Resolve a marker coordinate from a role's location string, falling back to the
 * company HQ for Remote/unknown locations. Pure + deterministic, so the map
 * never depends on latitude/longitude columns existing in the live schema.
 */
export function resolveMarkerCoords(
  locationString: string,
  workArrangement: string | null | undefined,
  hqLatitude: number | null,
  hqLongitude: number | null,
): { latitude: number | null; longitude: number | null } {
  const remote = workArrangement === 'Remote' || isRemoteLocation(locationString);
  if (!remote) {
    const hit = resolveRoleCoords(locationString);
    if (hit) return { latitude: hit.latitude, longitude: hit.longitude };
  }
  if (hqLatitude != null && hqLongitude != null) {
    return { latitude: hqLatitude, longitude: hqLongitude };
  }
  return { latitude: null, longitude: null };
}

export interface RoleMarkerInput {
  companyId: string;
  slug: string;
  name: string;
  companyType: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
  country: string | null;
}

/**
 * Group role-level coordinates into one marker per (company, rounded location),
 * counting active roles at that spot. Markers resolve a brand logo from the
 * company website domain (with the DB logo_url preferred when present).
 */
export function groupRolesIntoMarkers(roles: RoleMarkerInput[]): MapCompany[] {
  const byKey = new Map<string, MapCompany>();

  for (const r of roles) {
    if (r.latitude == null || r.longitude == null) continue;
    // Round coords so near-identical city points cluster into one marker.
    const key = `${r.companyId}@${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.activeRoleCount += 1;
      continue;
    }
    byKey.set(key, {
      id: key,
      slug: r.slug,
      name: r.name,
      companyType: r.companyType,
      websiteUrl: r.websiteUrl,
      logoUrl: logoForCompany({ logoUrl: r.logoUrl, websiteUrl: r.websiteUrl }),
      latitude: r.latitude,
      longitude: r.longitude,
      city: r.city,
      state: r.state,
      country: r.country,
      activeRoleCount: 1,
    });
  }

  return [...byKey.values()];
}
