-- ============================================================================
-- Launchpad — 0005_tracked_applications.sql
-- Run before deploying the tracking update. Existing applications are retained.
-- ============================================================================

begin;

-- Copy the legacy table only when creating the replacement for the first time.
-- Repeating this migration must not restore applications a user has untracked.
do $$
begin
  if to_regclass('public.tracked_applications') is null then
    create table public.tracked_applications (
      id              uuid primary key default gen_random_uuid(),
      user_id         uuid not null references auth.users(id) on delete cascade,
      role_id         uuid references public.roles(id) on delete set null,
      company_name    text not null,
      role_title      text not null,
      status          public.application_status not null default 'Applied',
      notes           text,
      application_url text,
      applied_at      date,
      follow_up_date  date,
      created_at      timestamptz not null default now(),
      updated_at      timestamptz not null default now()
    );

    insert into public.tracked_applications (
      id, user_id, role_id, company_name, role_title, status, notes,
      application_url, applied_at, follow_up_date, created_at, updated_at
    )
    select
      id, user_id, role_id, company_name, role_title, status, notes,
      application_url, applied_at, follow_up_date, created_at, updated_at
    from public.applications;
  end if;
end;
$$;

-- Unlike the old partial index, this index can be inferred by PostgREST's
-- upsert(..., { onConflict: 'user_id,role_id' }). NULL role IDs remain valid
-- for manual applications, which are subsequently updated by primary-key ID.
create unique index if not exists uq_tracked_applications_role
  on public.tracked_applications (user_id, role_id);

create unique index if not exists uq_tracked_applications_manual
  on public.tracked_applications (user_id, lower(company_name), lower(role_title))
  where role_id is null;

create index if not exists idx_tracked_applications_user_updated
  on public.tracked_applications (user_id, updated_at desc);

drop trigger if exists trg_tracked_applications_updated on public.tracked_applications;
create trigger trg_tracked_applications_updated
  before update on public.tracked_applications
  for each row execute function public.set_updated_at();

alter table public.tracked_applications enable row level security;

-- Guests use browser storage, so they do not need database privileges.
revoke all on table public.tracked_applications from public, anon;
grant select, insert, update, delete on table public.tracked_applications to authenticated;
grant all on table public.tracked_applications to service_role;

drop policy if exists tracked_applications_select_own on public.tracked_applications;
create policy tracked_applications_select_own
  on public.tracked_applications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists tracked_applications_insert_own on public.tracked_applications;
create policy tracked_applications_insert_own
  on public.tracked_applications for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists tracked_applications_update_own on public.tracked_applications;
create policy tracked_applications_update_own
  on public.tracked_applications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists tracked_applications_delete_own on public.tracked_applications;
create policy tracked_applications_delete_own
  on public.tracked_applications for delete to authenticated
  using ((select auth.uid()) = user_id);

-- This guard also keeps an older, accidentally broad permissive policy on an
-- existing tracked_applications table from granting access to another user.
drop policy if exists tracked_applications_owner_guard on public.tracked_applications;
create policy tracked_applications_owner_guard
  on public.tracked_applications as restrictive for all to public
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Notify the API after the transaction commits so the new table is available.
notify pgrst, 'reload schema';

commit;
