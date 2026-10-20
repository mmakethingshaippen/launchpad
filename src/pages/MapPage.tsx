import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { ArrowRight, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdapter } from '../hooks/useAdapter';
import { useRoleFilters } from '../hooks/useRoleFilters';
import { LoadingBlock } from '../components/ui/Spinner';
import { SeasonBadge } from '../components/ui/Badge';
import { SPECIFIC_SEASONS, type Season } from '../lib/adapter/types';
import { normalizeLongitude } from '../lib/ats/cityCoords';
import type { MapMarker } from '../lib/adapter';

const SINGLE_WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85, -180],
  [85, 180],
];

/**
 * Filter markers to a single company (by name, case-insensitive), returning a
 * new marker set whose roleCount/companyCount/roles reflect only that company.
 * Markers with no matching role are dropped so only that company's pins remain.
 */
export function filterMarkersByCompany(markers: MapMarker[], companyName: string): MapMarker[] {
  const q = companyName.trim().toLowerCase();
  if (!q) return markers;
  const out: MapMarker[] = [];
  for (const m of markers) {
    const roles = m.roles.filter((r) => r.companyName.toLowerCase() === q);
    if (roles.length === 0) continue;
    out.push({
      ...m,
      roles,
      roleCount: roles.length,
      companyCount: 1,
    });
  }
  return out;
}

/** Distinct company names across a marker set, sorted, for the search datalist. */
export function companyNamesFromMarkers(markers: MapMarker[]): string[] {
  const names = new Set<string>();
  for (const m of markers) for (const r of m.roles) names.add(r.companyName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Recenter/zoom the Leaflet map to fit the given markers (company search). */
function FitToMarkers({ markers, fitKey }: { markers: MapMarker[]; fitKey: string }) {
  const map = useMap();
  useMemo(() => {
    if (!fitKey) {
      map.setView([25, 0], 2, { animate: true });
      return;
    }
    if (markers.length === 0) return;
    const pts = markers.map((m) => [m.latitude, normalizeLongitude(m.longitude)] as [number, number]);
    if (pts.length === 1) {
      map.setView(pts[0], 6, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: true, maxZoom: 6 });
    }
    // fitKey changes only when the selected company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

// A pin whose badge shows the number of OPEN ROLES at that location.
function roleCountIcon(count: number): L.DivIcon {
  const label = count > 99 ? '99+' : String(count);
  const size = count >= 100 ? 44 : count >= 10 ? 40 : 34;
  return L.divIcon({
    className: '',
    html: `<div style="background:#00C9D8;border:2px solid #101B33;border-radius:9999px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;color:#101B33;font-weight:700;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.3)">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Cluster badge sums the role counts of its child markers (not marker count).
function clusterIcon(cluster: { getAllChildMarkers: () => Array<{ options: { roleCount?: number } }> }): L.DivIcon {
  const total = cluster
    .getAllChildMarkers()
    .reduce((sum, m) => sum + (m.options.roleCount ?? 1), 0);
  const label = total > 999 ? '999+' : String(total);
  const size = total >= 100 ? 52 : total >= 10 ? 46 : 40;
  return L.divIcon({
    className: '',
    html: `<div style="background:#101B33;border:3px solid #00C9D8;border-radius:9999px;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${label}</div>`,
    iconSize: [size, size],
  });
}

export function MapPage() {
  const adapter = useAdapter();
  const { filters, toggleSeason } = useRoleFilters();
  const [companyQuery, setCompanyQuery] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['map', filters],
    queryFn: () => adapter.getMapMarkers(filters),
  });

  const allMarkers = useMemo(() => data ?? [], [data]);
  const companyNames = useMemo(() => companyNamesFromMarkers(allMarkers), [allMarkers]);

  // When a company is selected/typed, show only its pins (Req 3).
  const markers = useMemo(
    () => filterMarkersByCompany(allMarkers, companyQuery),
    [allMarkers, companyQuery],
  );
  const activeCompany = companyQuery.trim();

  const totalRoles = markers.reduce((s, m) => s + m.roleCount, 0);
  const cities = markers.map((m) => m.label);
  // Stable identity for the current marker set — drives the cluster group's
  // remount key so clustering is recomputed cleanly on any data change.
  const markerSetKey = useMemo(
    () => `${activeCompany}:${markers.length}:${markers.map((m) => `${m.id}#${m.roleCount}`).join('|')}`,
    [markers, activeCompany],
  );

  return (
    <div>
      <Helmet>
        <title>Opportunity map — Launchpad</title>
        <meta name="description" content="Explore internships and early-career roles by their actual job city on an interactive map." />
      </Helmet>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Explore by location</h1>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick season filter">
          {[...SPECIFIC_SEASONS, 'Year-Round'].map((s) => {
            const active = filters.seasons.includes(s as Season);
            return (
              <button
                key={s}
                onClick={() => toggleSeason(s as Season)}
                aria-pressed={active}
                className={
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
                  (active ? 'bg-cyan text-navy' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-cyan')
                }
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Company search / browse mode (Req 3) */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            list="map-company-list"
            value={companyQuery}
            onChange={(e) => setCompanyQuery(e.target.value)}
            placeholder="Search a company (e.g. Waymo, Stripe, Nvidia)"
            aria-label="Search the map by company"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-9 text-sm outline-none focus:border-cyan"
          />
          <datalist id="map-company-list">
            {companyNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {companyQuery && (
            <button
              type="button"
              onClick={() => setCompanyQuery('')}
              aria-label="Clear company search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-navy"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {activeCompany && markers.length > 0 && (
          <span className="inline-flex items-center gap-2 rounded-full bg-cyan/10 px-3 py-1.5 text-sm font-medium text-navy ring-1 ring-cyan/30">
            <strong>{activeCompany}</strong>
            <span className="text-slate-500">
              {totalRoles} open {totalRoles === 1 ? 'role' : 'roles'} · {cities.length}{' '}
              {cities.length === 1 ? 'city' : 'cities'}
            </span>
          </span>
        )}
      </div>

      <p className="mb-1 text-sm text-slate-500" aria-live="polite">
        {isLoading
          ? 'Loading map…'
          : activeCompany && markers.length === 0
            ? `No open roles found for "${activeCompany}".`
            : `${totalRoles} open roles across ${markers.length} locations`}
      </p>
      <p className="mb-4 text-xs text-slate-400">
        Pins show each role's actual job city. Numbers are the count of open roles at that location.
      </p>

      {isLoading ? (
        <LoadingBlock label="Loading map" />
      ) : (
        <div className="h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200 bg-[#aad3df]">
          <MapContainer
            center={[25, 0]}
            zoom={2}
            minZoom={2}
            maxBounds={SINGLE_WORLD_BOUNDS}
            maxBoundsViscosity={1.0}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              noWrap={true}
              bounds={SINGLE_WORLD_BOUNDS}
            />
            <FitToMarkers markers={markers} fitKey={activeCompany} />
            <MarkerClusterGroup
              key={markerSetKey}
              iconCreateFunction={clusterIcon as never}
              removeOutsideVisibleBounds={false}
              maxClusterRadius={60}
              showCoverageOnHover={false}
            >
              {markers.map((m) => (
                <Marker
                  key={m.id}
                  position={[m.latitude, normalizeLongitude(m.longitude)]}
                  icon={roleCountIcon(m.roleCount)}
                  {...({ roleCount: m.roleCount } as object)}
                >
                  <Popup maxWidth={320}>
                    <MarkerPopup marker={m} />
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
          </MapContainer>
        </div>
      )}
    </div>
  );
}

const POPUP_INITIAL = 25;
const POPUP_STEP = 50;

export function MarkerPopup({ marker }: { marker: MapMarker }) {
  const [visible, setVisible] = useState(POPUP_INITIAL);
  const shown = marker.roles.slice(0, visible);
  const remaining = marker.roles.length - visible;

  // Deep-link to Browse pre-filtered to this location. Prefer the city; fall
  // back to the state so the link always narrows to this pin's area.
  const browseParams = new URLSearchParams();
  if (marker.city) browseParams.set('city', marker.city);
  else if (marker.state) browseParams.set('state', marker.state);
  const browseHref = `/browse?${browseParams.toString()}`;

  return (
    <div className="min-w-[240px]">
      <p className="text-base font-semibold text-navy">{marker.label}</p>
      <p className="mt-0.5 text-sm text-slate-500">
        {marker.roleCount} open {marker.roleCount === 1 ? 'role' : 'roles'} across {marker.companyCount}{' '}
        {marker.companyCount === 1 ? 'company' : 'companies'}
      </p>
      <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
        {shown.map((r) => (
          <li key={r.id} className="flex items-start gap-2">
            {r.companyLogoUrl ? (
              <img
                src={r.companyLogoUrl}
                alt=""
                className="mt-0.5 h-5 w-5 flex-shrink-0 rounded object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : null}
            <div className="min-w-0">
              <Link to={`/roles/${r.slug}`} className="block truncate text-sm font-medium text-navy hover:text-cyan">
                {r.title}
              </Link>
              <div className="flex flex-wrap items-center gap-1">
                <span className="truncate text-xs text-slate-500">{r.companyName}</span>
                {r.seasons.slice(0, 1).map((s) => (
                  <SeasonBadge key={s} season={s as Season} year={r.cohortYear} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisible((v) => Math.min(v + POPUP_STEP, marker.roles.length))}
          className="mt-2 w-full rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-navy transition-colors hover:bg-slate-200"
        >
          +{remaining} more… (show {Math.min(POPUP_STEP, remaining)})
        </button>
      )}

      <Link
        to={browseHref}
        className="mt-2 flex items-center justify-center gap-1 rounded-md border border-cyan px-2 py-1 text-xs font-semibold text-navy transition-colors hover:bg-cyan/10"
      >
        View all {marker.roleCount} {marker.roleCount === 1 ? 'role' : 'roles'} in Browse
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}