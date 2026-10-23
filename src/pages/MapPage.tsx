import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup, LayerGroup, useMap } from 'react-leaflet';
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
import type { MapMarker, MapMarkerRole } from '../lib/adapter';

const SINGLE_WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85, -180],
  [85, 180],
];

/** Trailing legal-entity suffixes so "Bechtel" matches "Bechtel Corporation". */
const TRAILING_LEGAL_SUFFIX =
  /(?:\s+(?:incorporated|corporation|company|limited|holdings|partners|llc|llp|ltd|inc|corp|pbc|plc|gmbh|co|lp|pc))+$/;

/**
 * Normalize company names before comparing.
 * Tolerates capitalization, whitespace, punctuation, a leading "the",
 * and legal suffixes (Inc, LLC, Corporation, …).
 */
export function companyKey(name: string): string {
  if (!name) return '';
  let key = name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '');
  for (let i = 0; i < 4; i += 1) {
    const next = key.replace(TRAILING_LEGAL_SUFFIX, '').trim();
    if (next === key) break;
    key = next;
  }
  return key;
}

/**
 * Isolate the roles for one selected company and recalculate marker counts.
 * Locations with no matching roles are removed.
 */
export function filterMarkersByCompany(markers: MapMarker[], companyName: string, exact = true, companySlug = ''): MapMarker[] {
  const selected = companyKey(companyName);
  if (!selected) return markers;

  return markers
    .map((marker) => {
      const matchingRoles = marker.roles.filter((role) => {
        if (companySlug) return role.companySlug === companySlug;
        const roleCompKey = companyKey(role.companyName);
        if (!roleCompKey || !selected) return false;
        return exact ? roleCompKey === selected : roleCompKey.includes(selected);
      });

      if (matchingRoles.length === 0) return null;

      return {
        ...marker,
        label: matchingRoles[0].locationLabel ?? marker.label,
        city: matchingRoles[0].locationCity === undefined ? marker.city : matchingRoles[0].locationCity,
        state: matchingRoles[0].locationState === undefined ? marker.state : matchingRoles[0].locationState,
        roles: matchingRoles,
        roleCount: matchingRoles.length,
        companyCount: new Set(matchingRoles.map((role) => role.companySlug || companyKey(role.companyName))).size,
      };
    })
    .filter((m): m is MapMarker => m !== null);
}

/** Distinct company names across the marker set, for tests and autocomplete. */
export function companyNamesFromMarkers(markers: MapMarker[]): string[] {
  return [
    ...new Set(
      markers
        .flatMap((marker) => marker.roles.map((role) => role.companyName.trim()))
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export interface CompanyMapOption {
  name: string;
  slug?: string;
  roleCount: number;
  cityCount: number;
  logoUrl?: string | null;
}

/** Build the selector from the SAME unfiltered markers used by the map. */
export function companyOptionsFromMarkers(markers: MapMarker[], unmappedRoles: MapMarkerRole[] = []): CompanyMapOption[] {
  const stats = new Map<
    string,
    {
      name: string;
      slug?: string;
      roleIds: Set<string>;
      cities: Set<string>;
      logoUrl?: string | null;
    }
  >();

  for (const marker of markers) {
    for (const role of marker.roles) {
      const name = role.companyName.trim();
      const key = role.companySlug || companyKey(name);
      if (!key) continue;

      const existing = stats.get(key);
      if (existing) {
        existing.roleIds.add(role.id);
        existing.cities.add(marker.id);
        if (!existing.logoUrl && role.companyLogoUrl) {
          existing.logoUrl = role.companyLogoUrl;
        }
      } else {
        stats.set(key, {
          name,
          slug: role.companySlug,
          roleIds: new Set([role.id]),
          cities: new Set([marker.id]),
          logoUrl: role.companyLogoUrl,
        });
      }
    }
  }

  for (const role of unmappedRoles) {
    const key = role.companySlug || companyKey(role.companyName);
    if (!key) continue;
    const entry = stats.get(key);
    if (entry) entry.roleIds.add(role.id);
    else stats.set(key, { name: role.companyName, slug: role.companySlug, roleIds: new Set([role.id]), cities: new Set(), logoUrl: role.companyLogoUrl });
  }

  return [...stats.values()]
    .map(({ name, slug, roleIds, cities, logoUrl }) => ({
      name,
      slug,
      roleCount: roleIds.size,
      cityCount: cities.size,
      logoUrl,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function uniqueRoleCount(markers: MapMarker[], unmappedRoles: MapMarkerRole[] = []): number {
  return new Set([...markers.flatMap(marker => marker.roles), ...unmappedRoles].map(role => role.id)).size;
}

/**
 * Refit after BOTH the company selection and marker data change.
 */
function FitToMarkers({
  markers,
  selectedCompany,
}: {
  markers: MapMarker[];
  selectedCompany: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedCompany) {
      map.setView([22, 0], 2.4, { animate: false });
      return;
    }

    const coordinates = markers
      .filter(
        (marker) =>
          Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude)
      )
      .map((marker) =>
        L.latLng(marker.latitude, normalizeLongitude(marker.longitude))
      );

    if (coordinates.length === 0) return;

    map.stop();
    if (coordinates.length === 1) {
      map.setView(coordinates[0], 7, { animate: false });
    } else {
      map.fitBounds(L.latLngBounds(coordinates).pad(0.25), {
        animate: false,
        maxZoom: 7,
      });
    }
  }, [map, markers, selectedCompany]);

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

// Cluster badge sums the role counts of its child markers.
function clusterIcon(cluster: {
  getAllChildMarkers: () => Array<{ options: { roleIds?: string[] } }>;
}): L.DivIcon {
  const total = new Set(cluster.getAllChildMarkers().flatMap(marker => marker.options.roleIds ?? [])).size;
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

  const initialCompany = searchParams.get('company') ?? '';
  const selectedSlug = searchParams.get('companySlug') ?? '';
  const [companyQuery, setCompanyQuery] = useState(initialCompany);
  const [selectedCompany, setSelectedCompany] = useState(initialCompany);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showAllOptions, setShowAllOptions] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const companyFromUrl = searchParams.get('company') ?? '';
    if (companyFromUrl !== selectedCompany) {
      setSelectedCompany(companyFromUrl);
      setCompanyQuery(companyFromUrl);
    }
  }, [searchParams, selectedCompany]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        comboboxRef.current &&
        !comboboxRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const setCompanyUrl = (nextCompany: string, slug = '') => {
    const nextParams = new URLSearchParams(searchParams);
    if (slug) nextParams.set('companySlug', slug);
    else nextParams.delete('companySlug');
    if (nextCompany.trim()) {
      nextParams.set('company', nextCompany.trim());
    } else {
      nextParams.delete('company');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleCompanyTyping = (nextQuery: string) => {
    setCompanyQuery(nextQuery);
    setDropdownOpen(true);
    setShowAllOptions(false);

    if (selectedCompany) {
      setSelectedCompany('');
      setCompanyUrl('');
    }
  };

  const handleSelectCompany = (company: string, slug = '') => {
    setCompanyQuery(company);
    setSelectedCompany(company);
    setDropdownOpen(false);
    setShowAllOptions(false);
    setCompanyUrl(company, slug);
  };

  const handleClearCompany = () => {
    setCompanyQuery('');
    setSelectedCompany('');
    setDropdownOpen(false);
    setShowAllOptions(false);
    setCompanyUrl('');
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setCopiedLink(false);
    }
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['map', filters],
    queryFn: async () => adapter.getMapData
      ? adapter.getMapData(filters)
      : { markers: await adapter.getMapMarkers(filters), unmappedRoles: [] as MapMarkerRole[] },
  });

  const allMarkers = useMemo(() => data?.markers ?? [], [data]);
  const allUnmapped = useMemo(() => data?.unmappedRoles ?? [], [data]);
  const companyOptions = useMemo(
    () => companyOptionsFromMarkers(allMarkers, allUnmapped),
    [allMarkers, allUnmapped]
  );

  const filteredCompanyOptions = useMemo(() => {
    if (showAllOptions) return companyOptions;
    const q = companyKey(companyQuery);
    if (!q) return companyOptions;
    return companyOptions.filter((option) => companyKey(option.name).includes(q));
  }, [companyOptions, companyQuery, showAllOptions]);

  const activeCompany = (selectedCompany || companyQuery).trim();
  const markers = useMemo(
    () => filterMarkersByCompany(allMarkers, activeCompany, Boolean(selectedCompany), selectedSlug),
    [allMarkers, activeCompany, selectedCompany, selectedSlug]
  );
  const unmappedRoles = useMemo(() => allUnmapped.filter(role =>
    !activeCompany || (selectedSlug ? role.companySlug === selectedSlug : selectedCompany
      ? companyKey(role.companyName) === companyKey(activeCompany)
      : companyKey(role.companyName).includes(companyKey(activeCompany)))
  ), [allUnmapped, activeCompany, selectedCompany, selectedSlug]);
  const visibleCompanyCount = useMemo(() => companyOptionsFromMarkers(markers, unmappedRoles).length,
    [markers, unmappedRoles]);

  const totalRoles = useMemo(
    () => uniqueRoleCount(markers, unmappedRoles),
    [markers, unmappedRoles]
  );
  const cityCount = useMemo(
    () => new Set(markers.map((marker) => `${marker.latitude.toFixed(4)},${marker.longitude.toFixed(4)}`)).size,
    [markers]
  );

  const markerSetKey = useMemo(
    () =>
      `${companyKey(activeCompany)}:${markers
        .map((marker) => `${marker.id}#${marker.roleCount}`)
        .join('|')}`,
    [activeCompany, markers]
  );
  // Selected companies render directly. This avoids the cluster layer's stale
  // animation/layer state when switching between a world view and a few pins.

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
          {[...SPECIFIC_SEASONS, 'Year-Round'].map((season) => {
            const active = filters.seasons.includes(season as Season);
            return (
              <button
                key={season}
                type="button"
                onClick={() => toggleSeason(season as Season)}
                aria-pressed={active}
                className={
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors ' +
                  (active
                    ? 'bg-cyan text-navy'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-cyan')
                }
              >
                {season}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative z-[9999] mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div ref={comboboxRef} className="relative w-full sm:w-96">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={companyQuery}
            onFocus={() => {
              setDropdownOpen(true);
              setShowAllOptions(false);
            }}
            onChange={(event) => handleCompanyTyping(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDropdownOpen(false);
              } else if (event.key === 'Enter' && filteredCompanyOptions.length > 0) {
                event.preventDefault();
                handleSelectCompany(filteredCompanyOptions[0].name, filteredCompanyOptions[0].slug);
              }
            }}
            placeholder="Filter by company (e.g. Bechtel, Waymo, Nvidia)…"
            aria-label="Search the map by company"
            aria-expanded={dropdownOpen}
            aria-controls="map-company-options"
            aria-autocomplete="list"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-14 text-sm text-navy placeholder:text-slate-400 outline-none transition-shadow focus:border-cyan focus:ring-2 focus:ring-cyan/20 shadow-sm"
          />

          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            {(companyQuery || activeCompany) && (
              <button
                type="button"
                onClick={handleClearCompany}
                aria-label="Clear company search"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const opening = !dropdownOpen;
                setDropdownOpen(opening);
                if (opening) setShowAllOptions(true);
              }}
              aria-label="Toggle company list"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>

          {dropdownOpen && (
            <div
              id="map-company-options"
              className="absolute left-0 right-0 top-full z-[10000] mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl ring-1 ring-slate-900/10"
            >
              <div className="sticky top-0 z-10 mb-1 flex items-center justify-between border-b border-slate-100 bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Companies ({filteredCompanyOptions.length})</span>
                <span>Open Roles</span>
              </div>

              {filteredCompanyOptions.length === 0 && (
                <p className="px-2.5 py-3 text-sm text-slate-500">
                  {isLoading ? 'Loading companies…' : 'No matching companies.'}
                </p>
              )}

              {filteredCompanyOptions.map((option) => {
                const isSelected = selectedSlug ? option.slug === selectedSlug : companyKey(option.name) === companyKey(activeCompany);
                return (
                  <button
                    key={option.slug || option.name}
                    type="button"
                    onClick={() => handleSelectCompany(option.name, option.slug)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-cyan/15 font-semibold text-navy'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {option.logoUrl ? (
                        <img
                          src={option.logoUrl}
                          alt=""
                          className="h-4 w-4 flex-shrink-0 rounded object-contain"
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <Building2
                          className="h-4 w-4 flex-shrink-0 text-slate-400"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{option.name}</span>
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {option.roleCount} {option.roleCount === 1 ? 'role' : 'roles'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {activeCompany && totalRoles > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-cyan/10 px-3 py-1.5 text-sm font-medium text-navy ring-1 ring-cyan/30">
              <strong>{activeCompany}</strong>
              <span className="text-slate-500">
                {totalRoles} open {totalRoles === 1 ? 'role' : 'roles'} · {cityCount}{' '}
                {cityCount === 1 ? 'location' : 'locations'}
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
          : isError
            ? 'Could not load the map. Please try again.'
            : activeCompany && markers.length === 0
              ? unmappedRoles.length > 0
                ? `${totalRoles} open roles for ${activeCompany}; no usable map location is available.`
                : `No open roles found for "${activeCompany}" with your current filters.`
              : `${totalRoles.toLocaleString()} open roles · ${visibleCompanyCount.toLocaleString()} ${visibleCompanyCount === 1 ? 'company' : 'companies'} · ${cityCount} mapped ${cityCount === 1 ? 'location' : 'locations'}${unmappedRoles.length ? ` · ${unmappedRoles.length} roles without coordinates` : ''}`}
      </p>
      <p className="mb-4 text-xs text-slate-400">
        Pins use available job locations; some coordinates are approximate. Headquarters fallbacks are labelled in the popup.
        Each role counts once in the total, even when offered in several locations.
      </p>

      {unmappedRoles.length > 0 && (
        <details className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-navy">
            {unmappedRoles.length} roles without usable coordinates
          </summary>
          <p className="my-2 text-xs text-slate-500">These listings remain available. Their job locations cannot currently be plotted.</p>
          <ul className="max-h-64 space-y-2 overflow-auto">
            {unmappedRoles.map(role => <li key={role.id} className="text-sm">
              <Link to={`/roles/${role.slug}`} className="text-navy underline">{role.companyName} — {role.title}</Link>
            </li>)}
          </ul>
        </details>
      )}

      {isLoading ? (
        <LoadingBlock label="Loading map" />
      ) : (
        <div
          className="relative z-0 isolate h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200"
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
            <FitToMarkers markers={markers} selectedCompany={activeCompany} />
            <CompanyMarkers
              key={markerSetKey}
              selected={Boolean(activeCompany)}
            >
              {markers.map((marker) => (
                <Marker
                  key={marker.id}
                  position={[marker.latitude, normalizeLongitude(marker.longitude)]}
                  icon={roleCountIcon(marker.roleCount)}
                  title={`${marker.label}: ${marker.roleCount} open roles`}
                  alt={`${marker.label}: ${marker.roleCount} open roles`}
                  {...({ roleIds: marker.roles.map(role => role.id) } as object)}
                >
                  <Popup maxWidth={320}>
                    <MarkerPopup
                      marker={marker}
                      activeCompany={activeCompany}
                      seasons={filters.seasons}
                    />
                  </Popup>
                </Marker>
              ))}
            </CompanyMarkers>
          </MapContainer>
        </div>
      )}
    </div>
  );
}

const POPUP_INITIAL = 25;
const POPUP_STEP = 50;

function CompanyMarkers({ selected, children }: { selected: boolean; children: ReactNode }) {
  if (selected) return <LayerGroup>{children}</LayerGroup>;
  return <MarkerClusterGroup iconCreateFunction={clusterIcon as never}
    removeOutsideVisibleBounds={false} maxClusterRadius={60}
    showCoverageOnHover={false} animate={false}>{children}</MarkerClusterGroup>;
}

export function MarkerPopup({
  marker,
  activeCompany,
  seasons = [],
}: {
  marker: MapMarker;
  activeCompany?: string;
  seasons?: Season[];
}) {
  const [visible, setVisible] = useState(POPUP_INITIAL);
  const shown = marker.roles.slice(0, visible);
  const remaining = marker.roles.length - visible;

  const browseParams = new URLSearchParams();
  const fallbackOrSharedLocation = marker.roles.some(role => role.locationKind === 'hq') ||
    new Set(marker.roles.map(role => role.locationCity ?? marker.city)).size > 1;
  if (!fallbackOrSharedLocation) {
    if (marker.city) browseParams.set('city', marker.city);
    else if (marker.state) browseParams.set('state', marker.state);
  }
  if (activeCompany) browseParams.set('q', activeCompany);
  seasons.forEach((s) => browseParams.append('season', s));

  const browseHref = `/browse?${browseParams.toString()}`;
  return (
    <div className="min-w-[240px]">
      <p className="text-base font-semibold text-navy">{marker.label}</p>
      {marker.roles.some(role => role.locationKind === 'hq') && <p className="text-xs text-amber-700">Roles labelled HQ fallback are shown at company headquarters because their precise job location was unavailable.</p>}
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
                {r.locationKind === 'hq' && <span className="text-xs text-amber-700">HQ fallback</span>}
                {r.locationLabel && <span className="text-xs text-slate-500">{r.locationLabel}</span>}
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
        {fallbackOrSharedLocation ? 'Browse matching opportunities' : `View all ${marker.roleCount} ${marker.roleCount === 1 ? 'role' : 'roles'} in Browse`}
        <ArrowRight className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
