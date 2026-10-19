-- ============================================================================
-- Launchpad — 0001_init.sql
-- Schema: enums, tables, constraints, indexes, triggers.
-- ============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── Enums ───────────────────────────────────────────────────────────────────
create type company_type       as enum ('Startup','Established Company','Other / Unknown');
create type startup_stage       as enum ('Pre-seed','Seed','Series A','Series B','Series C or later','Bootstrapped','Unknown / Not disclosed');
create type employee_range      as enum ('1-10','11-50','51-200','201-500','501+');
create type ats_provider        as enum ('greenhouse','lever','ashby','none');
create type moderation_status   as enum ('Pending','Approved','Rejected');
create type listing_status      as enum ('Active','Expired','Closed','Archived');
create type work_arrangement    as enum ('Remote','Hybrid','Onsite');
create type opportunity_type    as enum ('Internship','Co-op','Entry-level / New-grad');
create type work_schedule       as enum ('Full-time','Part-time');
create type compensation_status as enum ('Paid','Unpaid','Not disclosed');
create type degree_level        as enum ('Undergraduate','Graduate','New Grad');
create type season              as enum ('Spring','Summer','Fall','Winter','Year-Round');
create type field_type          as enum ('Technology','Business','Healthcare','Engineering','Finance','Marketing','Other');
create type location_type       as enum ('HQ','Office');
create type account_role        as enum ('student','admin');
create type application_status  as enum ('Applied','Interviewing','Offer','Rejected');

-- ── updated_at trigger helper ────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── companies ────────────────────────────────────────────────────────────────
create table public.companies (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,
  name                 text not null,
  logo_url             text,
  website_url          text,
  careers_url          text,
  description          text,
  fields               field_type[] not null default '{}',
  company_type         company_type not null default 'Other / Unknown',
  startup_stage        startup_stage,
  employee_count_range employee_range,
  founding_year        int check (founding_year is null or (founding_year between 1800 and extract(year from now())::int + 1)),
  degree_levels        degree_level[] not null default '{}',
  ats_provider         ats_provider not null default 'none',
  ats_board_token      text,
  source               text not null default 'seed',
  moderation_status    moderation_status not null default 'Pending',
  last_verified_at     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

-- ── company_locations ─────────────────────────────────────────────────────────
create table public.company_locations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  city          text,
  state         text,
  country       text,
  latitude      double precision,
  longitude     double precision,
  location_type location_type not null default 'HQ'
);
create index idx_company_locations_company on public.company_locations(company_id);

-- ── roles ──────────────────────────────────────────────────────────────────────
create table public.roles (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  slug                 text not null unique,
  external_job_id      text,
  title                text not null,
  field                field_type not null default 'Other',
  seasons              season[] not null default '{Year-Round}',
  cohort_year          int,
  city                 text,
  state                text,
  country              text,
  work_arrangement     work_arrangement not null default 'Onsite',
  degree_levels        degree_level[] not null default '{}',
  opportunity_type     opportunity_type not null default 'Internship',
  work_schedule        work_schedule not null default 'Full-time',
  compensation_status  compensation_status not null default 'Not disclosed',
  pay_min              numeric,
  pay_max              numeric,
  pay_currency         text,
  pay_period           text,
  duration             text,
  application_deadline date,
  apply_url            text not null,
  description          text,
  source               text not null default 'community',
  source_url           text,
  moderation_status    moderation_status not null default 'Pending',
  listing_status       listing_status not null default 'Active',
  last_verified_at     timestamptz,
  search_tsv           tsvector generated always as (
                         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))
                       ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

-- Dedup ATS roles: NULL external_job_id rows (community/manual) remain distinct in PG.
alter table public.roles
  add constraint uq_roles_company_external unique (company_id, external_job_id);

create index gin_roles_seasons  on public.roles using gin (seasons);
create index gin_roles_degrees  on public.roles using gin (degree_levels);
create index gin_companies_fields on public.companies using gin (fields);
create index gin_roles_search   on public.roles using gin (search_tsv);
create index idx_roles_moderation on public.roles (moderation_status, listing_status);
create index idx_roles_deadline  on public.roles (application_deadline);
create index idx_roles_company   on public.roles (company_id);

-- ── user_profiles ───────────────────────────────────────────────────────────────
create table public.user_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  account_role account_role not null default 'student',
  created_at   timestamptz not null default now()
);

-- Auto-create a student profile when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.user_profiles (id, account_role)
  values (new.id, 'student')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── saved_opportunities ──────────────────────────────────────────────────────────
create table public.saved_opportunities (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role_id)
);
create index idx_saved_user on public.saved_opportunities(user_id);

-- ── applications ───────────────────────────────────────────────────────────────
create table public.applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  role_id         uuid references public.roles(id) on delete set null,
  company_name    text not null,
  role_title      text not null,
  status          application_status not null default 'Applied',
  notes           text,
  application_url text,          -- refinement #2
  applied_at      date,
  follow_up_date  date,          -- refinement #2
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_applications_updated before update on public.applications
  for each row execute function public.set_updated_at();
create index idx_applications_user on public.applications(user_id);

-- Dedup: by role when linked, else by (company, title) for manual entries.
create unique index uq_app_role   on public.applications (user_id, role_id) where role_id is not null;
create unique index uq_app_manual on public.applications (user_id, lower(company_name), lower(role_title)) where role_id is null;

-- ── moderation_history ───────────────────────────────────────────────────────────
create table public.moderation_history (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,        -- 'company' | 'role'
  entity_id   uuid not null,
  action      text not null,        -- 'approved' | 'rejected' | 'edited'
  actor_id    uuid references auth.users(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now()
);
create index idx_modhist_entity on public.moderation_history(entity_type, entity_id);

-- ── listing_reports ───────────────────────────────────────────────────────────────
create table public.listing_reports (
  id          uuid primary key default gen_random_uuid(),
  role_id     uuid not null references public.roles(id) on delete cascade,
  reason      text not null,        -- 'expired' | 'broken' | 'incorrect' | 'other'
  details     text,
  reporter_id uuid references auth.users(id) on delete set null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_reports_role on public.listing_reports(role_id);
create index idx_reports_unresolved on public.listing_reports(resolved) where resolved = false;
