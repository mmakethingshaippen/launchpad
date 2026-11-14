-- Truthful fallback verification for aggregator roles.
--
-- Apply BEFORE deploying code that reads these columns. Safe to re-run.
--
-- last_verified_at keeps its meaning: the last time evidence for THIS role was
-- found. Attempts that found nothing are recorded in the new columns and never
-- change last_verified_at.
--
-- public_roles is `select r.*` expanded at creation time, so these internal
-- columns are not exposed through that view.
begin;

alter table public.roles
  add column if not exists last_verification_attempt_at timestamptz,
  add column if not exists last_verification_failure_at timestamptz,
  add column if not exists last_verification_failure_reason text,
  add column if not exists verification_failure_count integer not null default 0,
  add column if not exists next_verification_at timestamptz;

-- Keeps the "due for verification" scan cheap, including never-verified rows.
create index if not exists idx_roles_aggregator_verification
  on public.roles (last_verified_at nulls first, id)
  where source = 'aggregator' and listing_status = 'Active';

-- One row per fallback verification run: counts, pagination and whether the
-- requested cycle completed. Written by the service role only.
create table if not exists public.aggregator_verification_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'completed', 'incomplete')),
  eligible integer not null default 0,
  waiting_retry integer not null default 0,
  attempted integer not null default 0,
  verified integer not null default 0,
  closed integer not null default 0,
  unreadable integer not null default 0,
  failed integer not null default 0,
  deferred integer not null default 0,
  write_failures integer not null default 0,
  backlog integer not null default 0,
  pagination_complete boolean not null default false,
  pagination_stop_reason text,
  cycle_complete boolean not null default false
);

create index if not exists idx_aggregator_verification_runs_started
  on public.aggregator_verification_runs (started_at desc);

alter table public.aggregator_verification_runs enable row level security;
revoke all on public.aggregator_verification_runs from public, anon, authenticated;
grant all on public.aggregator_verification_runs to service_role;

notify pgrst, 'reload schema';

commit;
