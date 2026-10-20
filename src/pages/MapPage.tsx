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

  const markers = data ?? [];

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
        {isLoading ? 'Loading map…' : `${markers.length} mapped job locations`}
      </p>
      <p className="mb-4 text-xs text-slate-400">
        Pins show each role's actual job city. Fully remote roles are discoverable in Browse and are not placed on the map.
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
              {markers.map((m) => (
                <Marker key={m.id} position={[m.latitude, m.longitude]} icon={markerIcon}>
                  <Popup>
                    <div className="min-w-[180px]">
                      <div className="flex items-center gap-2">
                        {m.logoUrl && (
                          <img
                            src={m.logoUrl}
                            alt=""
                            className="h-6 w-6 rounded object-contain"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        )}
                        <p className="font-semibold text-navy">{m.name}</p>
                      </div>
                      <div className="my-1">
                        <Badge tone={m.companyType === 'Startup' ? 'cyan' : 'muted'}>{m.companyType}</Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {[m.city, m.state, m.country].filter(Boolean).join(', ')}
                      </p>
                      <p className="mt-1 text-sm font-medium text-navy">
                        {m.activeRoleCount} active {m.activeRoleCount === 1 ? 'role' : 'roles'} here
                      </p>
                      <Link to={`/companies/${m.slug}`} className="mt-2 inline-block text-sm text-cyan underline">
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
