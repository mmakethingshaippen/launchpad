import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdapter } from '../hooks/useAdapter';
import { useRoleFilters } from '../hooks/useRoleFilters';
import { LoadingBlock } from '../components/ui/Spinner';
import { SeasonBadge } from '../components/ui/Badge';
import { SPECIFIC_SEASONS, type Season } from '../lib/adapter/types';
import type { MapMarker } from '../lib/adapter';

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

  const { data, isLoading } = useQuery({
    queryKey: ['map', filters],
    queryFn: () => adapter.getMapMarkers(filters),
  });

  const markers = data ?? [];
  const totalRoles = markers.reduce((s, m) => s + m.roleCount, 0);

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

      <p className="mb-3 text-sm text-slate-500" aria-live="polite">
        {isLoading ? 'Loading map…' : `${totalRoles} open roles across ${markers.length} locations`}
      </p>
      <p className="mb-4 text-xs text-slate-400">
        Pins show each role's actual job city. Numbers are the count of open roles at that location.
      </p>

      {isLoading ? (
        <LoadingBlock label="Loading map" />
      ) : (
        <div className="h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200">
          <MapContainer center={[39.5, -98.35]} zoom={4} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MarkerClusterGroup chunkedLoading iconCreateFunction={clusterIcon as never}>
              {markers.map((m) => (
                <Marker
                  key={m.id}
                  position={[m.latitude, m.longitude]}
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
