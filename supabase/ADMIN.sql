-- ============================================================================
-- Launchpad — Admin elevation
--
-- Run ONCE after the intended admin has signed up through the app, using the
-- Supabase SQL editor or the service role. RLS prevents a user from elevating
-- their own account_role, so this must be done out-of-band.
-- ============================================================================

update public.user_profiles
set account_role = 'admin'
where id = (
  select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
);

-- Verify:
-- select up.account_role, u.email
-- from public.user_profiles up
-- join auth.users u on u.id = up.id
-- where u.email = 'YOUR_ADMIN_EMAIL';
