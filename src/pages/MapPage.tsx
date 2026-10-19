import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { Link } from 'react-router-dom';
import { useAdapter } from '../hooks/useAdapter';
import { useRoleFilters } from '../hooks/useRoleFilters';
import { LoadingBlock } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { SPECIFIC_SEASONS } from '../lib/adapter/types';

// Custom marker icon to avoid Leaflet's default-asset path issues in bundlers.
const markerIcon = L.divIcon({
  className: '',
  html: '<div style="background:#00C9D8;border:2px solid #101B33;border-radius:50% 50% 50% 0;width:18px;height:18px;transform:rotate(-45deg)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
  popupAnchor: [0, -18],
});

export function MapPage() {
  const adapter = useAdapter();
  const { filters, toggleSeason } = useRoleFilters();

  const { data, isLoading } = useQuery({
    queryKey: ['map', filters],
    queryFn: () => adapter.getMapCompanies(filters),
  });

  const companies = data ?? [];

  return (
    <div>
      <Helmet>
        <title>Opportunity map — Launchpad</title>
        <meta name="description" content="Explore internships and early-career roles by location on an interactive map." />
      </Helmet>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-navy">Explore by location</h1>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick season filter">
          {[...SPECIFIC_SEASONS, 'Year-Round'].map((s) => {
            const active = filters.seasons.includes(s as never);
            return (
              <button
                key={s}
                onClick={() => toggleSeason(s as never)}
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
        {isLoading ? 'Loading map…' : `${companies.length} companies with mapped locations`}
      </p>
      <p className="mb-4 text-xs text-slate-400">
        Fully remote roles are discoverable in Browse and are intentionally not placed on the map.
      </p>

      {isLoading ? (
        <LoadingBlock label="Loading map" />
      ) : (
        <div className="h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200">
          <MapContainer
            center={[39.5, -98.35]}
            zoom={4}
            scrollWheelZoom
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MarkerClusterGroup chunkedLoading>
              {companies.map((c) => (
                <Marker key={c.id} position={[c.latitude, c.longitude]} icon={markerIcon}>
                  <Popup>
                    <div className="min-w-[180px]">
                      <p className="font-semibold text-navy">{c.name}</p>
                      <div className="my-1">
                        <Badge tone={c.companyType === 'Startup' ? 'cyan' : 'muted'}>{c.companyType}</Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {[c.city, c.state, c.country].filter(Boolean).join(', ')}
                      </p>
                      <p className="mt-1 text-sm font-medium text-navy">
                        {c.activeRoleCount} active {c.activeRoleCount === 1 ? 'role' : 'roles'}
                      </p>
                      <Link to={`/companies/${c.slug}`} className="mt-2 inline-block text-sm text-cyan underline">
                        View company & roles
                      </Link>
                    </div>
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
