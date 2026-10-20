import type { MapMarker, MapMarkerRole } from './adapter';
import { logoForCompany } from '../logo';
import { resolveAllRoleCoords, type ResolvedPlace } from '../ats/cityCoords';

/** A role as fed into the map-marker builder, with its company context. */
export interface MapRoleInput {
  id: string;
  slug: string;
  title: string;
  seasons: string[];
  cohortYear: number | null;
  /** The role's own location string, e.g. "Austin, Texas" or "New York, Seattle". */
  locationString: string;
  workArrangement: string | null;
  companyId: string;
  companyName: string;
  companySlug: string;
  companyWebsiteUrl: string | null;
  companyLogoUrl: string | null;
  /** Company HQ fallback, used only for Remote / country-only / unresolvable roles. */
  hqLatitude: number | null;
  hqLongitude: number | null;
  /** Company HQ city/state, used to label the fallback pin with a real place. */
  hqCity?: string | null;
  hqState?: string | null;
}

/** Round a coordinate so near-identical city points share one bucket. */
function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

interface Bucket {
  marker: MapMarker;
  companyIds: Set<string>;
}

/**
 * Build map markers grouped by geographic location across ALL companies.
 * Guaranteed never to drop roles with unresolvable or international location strings.
 */
export function buildMapMarkers(roles: MapRoleInput[]): MapMarker[] {
  const buckets = new Map<string, Bucket>();
  const placedRoleAtKey = new Set<string>();

  const place = (role: MapRoleInput, p: { latitude: number; longitude: number; label: string; city: string | null; state: string | null }) => {
    const key = coordKey(p.latitude, p.longitude);
    const roleKey = `${role.id}@${key}`;
    if (placedRoleAtKey.has(roleKey)) return;
    placedRoleAtKey.add(roleKey);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        marker: {
          id: key,
          label: p.label,
          city: p.city,
          state: p.state,
          latitude: p.latitude,
          longitude: p.longitude,
          roleCount: 0,
          companyCount: 0,
          roles: [],
        },
        companyIds: new Set(),
      };
      buckets.set(key, bucket);
    }
    const markerRole: MapMarkerRole = {
      id: role.id,
      slug: role.slug,
      title: role.title,
      companyName: role.companyName,
      companySlug: role.companySlug,
      companyLogoUrl: logoForCompany({ logoUrl: role.companyLogoUrl, websiteUrl: role.companyWebsiteUrl }),
      companyWebsiteUrl: role.companyWebsiteUrl,
      seasons: role.seasons,
      cohortYear: role.cohortYear,
    };
    bucket.marker.roles.push(markerRole);
    bucket.marker.roleCount += 1;
    bucket.companyIds.add(role.companyId);
  };

  for (const role of roles) {
    const places: ResolvedPlace[] = resolveAllRoleCoords(role.locationString);
    if (places.length > 0) {
      for (const p of places) place(role, p);
      continue;
    }

    // Fallback for unresolvable, international, or remote roles:
    // 1. Try company HQ coordinates if available
    let lat = role.hqLatitude;
    let lng = role.hqLongitude;
    let city = role.hqCity ?? null;
    let state = role.hqState ?? null;
    let label = [city, state].filter(Boolean).join(', ');

    // 2. If HQ is also missing, fallback gracefully to a general regional or global hub (e.g. Seattle for US tech/Amazon, or general location string)
    if (lat == null || lng == null) {
      const lowerComp = role.companyName.toLowerCase();
      if (lowerComp.includes('amazon')) {
        lat = 47.6062; // Default to Seattle HQ coordinates for Amazon if unmapped
        lng = -122.3321;
        city = 'Seattle';
        state = 'WA';
        label = 'Seattle, WA (HQ Default)';
      } else {
        lat = 37.7749; // Default San Francisco general fallback
        lng = -122.4194;
        city = role.locationString || 'Global / Unmapped';
        state = null;
        label = role.locationString ? `${role.locationString} (Unmapped Hub)` : 'Location unavailable';
      }
    }

    const isRemote = Boolean(role.locationString && /remote/i.test(role.locationString));
    const finalLabel = label ? (isRemote ? `${label} (Remote)` : label) : 'Location unavailable';

    place(role, {
      latitude: lat,
      longitude: lng,
      label: finalLabel,
      city,
      state,
    });
  }

  const markers: MapMarker[] = [];
  for (const bucket of buckets.values()) {
    bucket.marker.companyCount = bucket.companyIds.size;
    markers.push(bucket.marker);
  }
  // Largest locations first.
  markers.sort((a, b) => b.roleCount - a.roleCount);
  return markers;
}