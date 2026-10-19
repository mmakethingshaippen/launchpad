-- ============================================================================
-- Launchpad — 0002_rls.sql
-- public_roles view + Row Level Security policies.
-- ============================================================================

-- ── is_admin() helper (security definer: reads user_profiles without RLS recursion)
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_profiles
    where id = auth.uid() and account_role = 'admin'
  );
$$;

-- ============================================================================
-- public_roles VIEW
-- Enforces the FULL public-eligibility rule (Req 16) for all search/browse/
-- featured/company-profile role queries. security_invoker=on so the view
-- respects the caller's RLS rather than the view owner's.
--
-- Refinement #1: The strict listing_status='Active' and deadline checks live
-- HERE (not in the base-table RLS policy) so that getRole(slug) can still load
-- a recently closed/expired approved role from the base table to render the
-- "Closed / no longer accepting applications" banner (Req 9.8).
-- ============================================================================
create view public.public_roles
with (security_invoker = on) as
select r.*
from public.roles r
join public.companies c on c.id = r.company_id
where r.moderation_status = 'Approved'
  and c.moderation_status = 'Approved'
  and r.listing_status = 'Active'
  and (r.application_deadline is null or r.application_deadline >= current_date);

-- ── Enable RLS on every table ─────────────────────────────────────────────────
alter table public.companies          enable row level security;
alter table public.company_locations  enable row level security;
alter table public.roles              enable row level security;
alter table public.user_profiles      enable row level security;
alter table public.saved_opportunities enable row level security;
alter table public.applications       enable row level security;
alter table public.moderation_history enable row level security;
alter table public.listing_reports    enable row level security;

-- ── companies ──────────────────────────────────────────────────────────────────
-- Public read of approved companies.
create policy companies_public_read on public.companies for select
  using (moderation_status = 'Approved');
-- Community may suggest a company; forced to Pending + community source.
create policy companies_community_insert on public.companies for insert
  with check (moderation_status = 'Pending' and source = 'community');
-- Admin full access.
create policy companies_admin_all on public.companies for all
  using (public.is_admin()) with check (public.is_admin());

-- ── company_locations ─────────────────────────────────────────────────────────
create policy locations_public_read on public.company_locations for select
  using (exists (
    select 1 from public.companies c
    where c.id = company_id and c.moderation_status = 'Approved'
  ));
create policy locations_admin_all on public.company_locations for all
  using (public.is_admin()) with check (public.is_admin());

-- ── roles ──────────────────────────────────────────────────────────────────────
-- Refinement #1: base-table read is approved-role + approved-company ONLY.
-- No listing_status filter here so closed/expired approved roles still load
-- for the Closed banner. Strict active/deadline filtering is in public_roles.
create policy roles_public_read on public.roles for select
  using (
    moderation_status = 'Approved'
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.moderation_status = 'Approved'
    )
  );
-- Community may post a role; forced to Pending + community source.
create policy roles_community_insert on public.roles for insert
  with check (moderation_status = 'Pending' and source = 'community');
-- Admin full access.
create policy roles_admin_all on public.roles for all
  using (public.is_admin()) with check (public.is_admin());

-- ── user_profiles ────────────────────────────────────────────────────────────────
create policy profile_read on public.user_profiles for select
  using (id = auth.uid() or public.is_admin());
create policy profile_insert on public.user_profiles for insert
  with check (id = auth.uid() and account_role = 'student');
-- No self-elevation: a non-admin updating their own row must keep account_role='student'.
create policy profile_update on public.user_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and account_role = 'student');
create policy profile_admin_all on public.user_profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- ── saved_opportunities (owner-only) ───────────────────────────────────────────
create policy saved_owner on public.saved_opportunities for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── applications (owner-only) ──────────────────────────────────────────────────
create policy app_owner on public.applications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── listing_reports: anyone (incl. anon) may insert; only admins read/update ────
create policy reports_anon_insert on public.listing_reports for insert
  with check (true);
create policy reports_admin_read on public.listing_reports for select
  using (public.is_admin());
create policy reports_admin_update on public.listing_reports for update
  using (public.is_admin()) with check (public.is_admin());

-- ── moderation_history: admin read; writes via admin/service role ──────────────
create policy modhist_admin_read on public.moderation_history for select
  using (public.is_admin());
create policy modhist_admin_insert on public.moderation_history for insert
  with check (public.is_admin());

-- ============================================================================
-- Admin bootstrap (run manually AFTER the first admin signs up):
--
--   update public.user_profiles
--   set account_role = 'admin'
--   where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
--
-- This is performed with the service role (bypasses the no-self-elevation
-- policy), or directly in the SQL editor. See README.md.
-- ============================================================================
