import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { ArrowRight, Building2, Check, ChevronDown, Share2, Search, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
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
    const distinctCompanies = new Set(roles.map((r) => r.companyName.toLowerCase())).size;
    out.push({
      ...m,
      roles,
      roleCount: roles.length,
      companyCount: distinctCompanies,
    });
  }
  return out;
}

/** Distinct company names across a marker set, sorted, for tests & autocomplete. */
export function companyNamesFromMarkers(markers: MapMarker[]): string[] {
  const names = new Set<string>();
  for (const m of markers) for (const r of m.roles) names.add(r.companyName);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Distinct companies with their total mapped role counts and logo URLs. */
export interface CompanyMapOption {
  name: string;
  roleCount: number;
  cityCount: number;
  logoUrl?: string | null;
}

export function companyOptionsFromMarkers(markers: MapMarker[]): CompanyMapOption[] {
  const stats = new Map<string, { roleCount: number; cities: Set<string>; logoUrl?: string | null }>();
  for (const m of markers) {
    for (const r of m.roles) {
      const existing = stats.get(r.companyName);
      if (existing) {
        existing.roleCount += 1;
        existing.cities.add(m.label);
        if (!existing.logoUrl && r.companyLogoUrl) existing.logoUrl = r.companyLogoUrl;
      } else {
        stats.set(r.companyName, {
          roleCount: 1,
          cities: new Set([m.label]),
          logoUrl: r.companyLogoUrl,
        });
      }
    }
  }
  return [...stats.entries()]
    .map(([name, info]) => ({
      name,
      roleCount: info.roleCount,
      cityCount: info.cities.size,
      logoUrl: info.logoUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Recenter/zoom the Leaflet map to fit the given markers (company search). */
function FitToMarkers({ markers, fitKey }: { markers: MapMarker[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!fitKey) {
      map.setView([22, 0], 2.4, { animate: true });
      return;
    }
    if (markers.length === 0) return;
    const pts = markers.map((m) => [m.latitude, normalizeLongitude(m.longitude)] as [number, number]);
    if (pts.length === 1) {
      map.setView(pts[0], 6, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(pts).pad(0.25), { animate: true, maxZoom: 6 });
    }
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
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize from ?company= query param if present so map links are shareable
  const initialCompany = searchParams.get('company') ?? '';
  const [companyQuery, setCompanyQuery] = useState(initialCompany);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  // Sync companyQuery if the URL ?company= param changes externally
  useEffect(() => {
    const paramCompany = searchParams.get('company') ?? '';
    if (paramCompany !== companyQuery) {
      setCompanyQuery(paramCompany);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Close custom dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateCompanySelection = (nextCompany: string) => {
    setCompanyQuery(nextCompany);
    const nextParams = new URLSearchParams(searchParams);
    if (nextCompany.trim()) {
      nextParams.set('company', nextCompany.trim());
    } else {
      nextParams.delete('company');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleCopyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['map', filters],
    queryFn: () => adapter.getMapMarkers(filters),
  });

  const allMarkers = useMemo(() => data ?? [], [data]);
  const companyOptions = useMemo(() => companyOptionsFromMarkers(allMarkers), [allMarkers]);

  // Filter dropdown suggestions while typing
  const filteredCompanyOptions = useMemo(() => {
    const q = companyQuery.trim().toLowerCase();
    if (!q) return companyOptions;
    // If the user has an exact match selected, still show matching or all options cleanly
    const matches = companyOptions.filter((c) => c.name.toLowerCase().includes(q));
    return matches.length > 0 ? matches : companyOptions;
  }, [companyOptions, companyQuery]);

  // When a company is selected/typed, show only its pins (Req 3).
  const markers = useMemo(
    () => filterMarkersByCompany(allMarkers, companyQuery),
    [allMarkers, companyQuery],
  );
  const activeCompany = companyQuery.trim();

  const totalRoles = markers.reduce((s, m) => s + m.roleCount, 0);
  const cities = markers.map((m) => m.label);
  const markerSetKey = useMemo(
    () => `${activeCompany}:${markers.length}:${markers.map((m) => `${m.id}#${m.roleCount}`).join('|')}`,
    [markers, activeCompany],
  );

  return (
    <div>
      <Helmet>
        <title>
          {activeCompany ? `${activeCompany} Map — Launchpad` : 'Opportunity Map — Launchpad'}
        </title>
        <meta
          name="description"
          content="Explore internships and early-career roles by their actual job city on an interactive map."
        />
      </Helmet>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-navy">Explore by location</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            Live ATS feeds · Updated daily
          </span>
        </div>

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

      {/* Custom Polished Company Combobox + Shareable Summary Pill */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div ref={comboboxRef} className="relative w-full sm:w-96 z-[1000]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={companyQuery}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              updateCompanySelection(e.target.value);
              setDropdownOpen(true);
            }}
            placeholder="Filter by company (e.g. Waymo, Stripe, Nvidia)…"
            aria-label="Search the map by company"
            aria-expanded={dropdownOpen}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-14 text-sm text-navy placeholder:text-slate-400 outline-none transition-shadow focus:border-cyan focus:ring-2 focus:ring-cyan/20"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {companyQuery && (
              <button
                type="button"
                onClick={() => {
                  updateCompanySelection('');
                  setDropdownOpen(false);
                }}
                aria-label="Clear company search"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              aria-label="Toggle company list"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>

          {dropdownOpen && companyOptions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5">
              <div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                <span>Companies with mapped roles ({filteredCompanyOptions.length})</span>
                <span>Open Roles</span>
              </div>
              {filteredCompanyOptions.map((opt) => {
                const isSelected = opt.name.toLowerCase() === activeCompany.toLowerCase();
                return (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => {
                      updateCompanySelection(opt.name);
                      setDropdownOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-cyan/15 font-semibold text-navy'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {opt.logoUrl ? (
                        <img
                          src={opt.logoUrl}
                          alt=""
                          className="h-4 w-4 flex-shrink-0 rounded object-contain"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <Building2 className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
                      )}
                      <span className="truncate">{opt.name}</span>
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {opt.roleCount} {opt.roleCount === 1 ? 'role' : 'roles'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activeCompany && markers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-cyan/10 px-3 py-1.5 text-sm font-medium text-navy ring-1 ring-cyan/30">
              <strong>{activeCompany}</strong>
              <span className="text-slate-500">
                {totalRoles} open {totalRoles === 1 ? 'role' : 'roles'} · {cities.length}{' '}
                {cities.length === 1 ? 'city' : 'cities'}
              </span>
            </span>
            <button
              type="button"
              onClick={handleCopyShareLink}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition-colors hover:border-cyan hover:text-navy"
              title="Copy shareable link to this company's map"
            >
              {copiedLink ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span className="text-emerald-700">Copied link!</span>
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Share map</span>
                </>
              )}
            </button>
          </div>
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
        Pins show each role's actual job city. Click any company in the search bar to isolate its office hubs.
      </p>

      {isLoading ? (
        <LoadingBlock label="Loading map" />
      ) : (
        <div
          className="h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200"
          style={{ backgroundColor: '#aad3df' }}
        >
          <MapContainer
            center={[22, 0]}
            zoom={2.4}
            minZoom={2.3}
            zoomSnap={0.1}
            zoomDelta={0.5}
            maxBounds={SINGLE_WORLD_BOUNDS}
            maxBoundsViscosity={1.0}
            scrollWheelZoom
            style={{ height: '100%', width: '100%', backgroundColor: '#aad3df' }}
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