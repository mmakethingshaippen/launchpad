-- ============================================================================
-- Launchpad — 0003_role_coords.sql
-- Per-role geocoordinates so the map can plot roles at their actual job city
-- (not just the company HQ). Resolved from the role location string during
-- ATS sync via the deterministic city lookup in src/lib/ats/cityCoords.ts.
-- ============================================================================

alter table public.roles add column if not exists latitude  double precision;
alter table public.roles add column if not exists longitude double precision;

-- Index to support map bounding-box / non-null coordinate queries.
create index if not exists idx_roles_coords
  on public.roles (latitude, longitude)
  where latitude is not null and longitude is not null;
