-- Seven-day verification freshness for public listings.
--
-- Requires 0002 (public_roles), 0007 and 0008. Safe to re-run.
--
-- Adds ONE restriction to public.public_roles:
--     r.last_verified_at >= now() - interval '7 days'
-- A NULL last_verified_at fails this comparison, so never-verified jobs are
-- hidden until a real verification succeeds. Only last_verified_at counts:
-- created_at and failed/blocked attempt timestamps do not extend visibility.
--
-- GUARDS. The view is changed only if ALL of these hold; otherwise the whole
-- migration aborts and nothing changes:
--  1. The existing definition, normalised, is exactly the supported 0002
--     definition (or the 0009 definition, for a re-run). Any extra, missing or
--     different WHERE condition, join or select-list expression aborts with the
--     normalised definition in the error message for review.
--  2. Every view column is a plain r.<column> of public.roles, in order.
--  3. security_invoker is on.
--  After replacing, it verifies that the column names and types, owner,
--  privileges (relacl) and reloptions are unchanged; if not, it aborts.
--
-- Normalisation (for comparison only): lower case, whitespace collapsed,
-- type casts (::type), the "public." schema prefix, parentheses and the trailing
-- semicolon removed. Removing parentheses cannot hide an added condition; it
-- only ignores how Postgres chooses to bracket the same expression.
--
-- Nothing is deleted, closed or re-dated. Stale jobs stay in public.roles,
-- remain readable by direct link through the roles_public_read RLS policy
-- (the app shows "temporarily unavailable while we verify it"), and remain
-- eligible for background verification, which reads public.roles directly.
-- A job reappears as soon as a successful verification sets last_verified_at.
begin;

create or replace function pg_temp.lp_norm_viewdef(def text) returns text
language sql immutable as $fn$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(def), '::[a-z_."]+(\[\])?', '', 'g'),
        'public\.', '', 'g'),
      '[();]', '', 'g'),
    '\s+', ' ', 'g'))
$fn$;

do $migration$
declare
  v_view constant regclass := to_regclass('public.public_roles');
  v_supported_body constant text :=
    'from roles r join companies c on c.id = r.company_id'
    || ' where r.moderation_status = ''approved'' and c.moderation_status = ''approved'''
    || ' and r.listing_status = ''active'''
    || ' and r.application_deadline is null or r.application_deadline >= current_date';
  v_freshness_suffix constant text := ' and r.last_verified_at >= now - ''7 days''';
  v_norm text;
  v_from int;
  v_select text;
  v_body text;
  v_cols text;
  v_foreign text;
  v_cols_before text;
  v_cols_after text;
  v_acl_before text;
  v_acl_after text;
  v_owner_before oid;
  v_owner_after oid;
  v_opts_before text[];
  v_opts_after text[];
begin
  if v_view is null then
    raise exception '0009 aborted: public.public_roles does not exist. Apply 0002_rls.sql first.';
  end if;

  select relacl::text, relowner, reloptions
    into v_acl_before, v_owner_before, v_opts_before
  from pg_class where oid = v_view;

  if not coalesce(v_opts_before && array['security_invoker=on', 'security_invoker=true', 'security_invoker=1'], false) then
    raise exception '0009 aborted: public_roles reloptions are % (expected security_invoker on). Review before applying.',
      coalesce(v_opts_before::text, 'none');
  end if;

  -- Guard 2: every column is a roles column (0002 was select r.*).
  select string_agg(a.attname, ', ')
    into v_foreign
  from pg_attribute a
  where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped
    and not exists (
      select 1 from pg_attribute b
      where b.attrelid = 'public.roles'::regclass and b.attname = a.attname and not b.attisdropped);
  if v_foreign is not null then
    raise exception '0009 aborted: public_roles has columns that are not on roles (%).', v_foreign;
  end if;

  select string_agg(format('r.%I', a.attname), ', ' order by a.attnum),
         string_agg(a.attname || ':' || a.atttypid::regtype::text, ',' order by a.attnum)
    into v_cols, v_cols_before
  from pg_attribute a
  where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped;

  -- Guard 1: the definition must be the supported one.
  v_norm := pg_temp.lp_norm_viewdef(pg_get_viewdef(v_view, true));
  v_from := position(' from ' in v_norm);
  if v_from = 0 then
    raise exception '0009 aborted: cannot parse the public_roles definition: %', left(v_norm, 2000);
  end if;
  v_select := left(v_norm, v_from - 1);
  v_body := substr(v_norm, v_from + 1);

  if v_select <> 'select ' || lower(v_cols) then
    raise exception '0009 aborted: unexpected public_roles select list: %', left(v_select, 2000);
  end if;
  if v_body <> v_supported_body and v_body <> v_supported_body || v_freshness_suffix then
    raise exception '0009 aborted: public_roles definition differs from the supported definition. Found: % | Expected: %',
      left(v_body, 2000), v_supported_body;
  end if;

  execute format($view$
    create or replace view public.public_roles
    with (security_invoker = on) as
    select %s
    from public.roles r
    join public.companies c on c.id = r.company_id
    where r.moderation_status = 'Approved'
      and c.moderation_status = 'Approved'
      and r.listing_status = 'Active'
      and (r.application_deadline is null or r.application_deadline >= current_date)
      and r.last_verified_at >= now() - interval '7 days'
  $view$, v_cols);

  -- Post-checks: same columns and types, owner, privileges and options.
  select string_agg(a.attname || ':' || a.atttypid::regtype::text, ',' order by a.attnum)
    into v_cols_after
  from pg_attribute a
  where a.attrelid = v_view and a.attnum > 0 and not a.attisdropped;
  select relacl::text, relowner, reloptions
    into v_acl_after, v_owner_after, v_opts_after
  from pg_class where oid = v_view;

  if v_cols_after is distinct from v_cols_before then
    raise exception '0009 aborted: column list changed (% -> %).', v_cols_before, v_cols_after;
  end if;
  if v_acl_after is distinct from v_acl_before or v_owner_after is distinct from v_owner_before then
    raise exception '0009 aborted: privileges or owner changed (% -> %).', v_acl_before, v_acl_after;
  end if;
  if v_opts_after is distinct from v_opts_before then
    raise exception '0009 aborted: view options changed (% -> %).', v_opts_before, v_opts_after;
  end if;
  if pg_temp.lp_norm_viewdef(pg_get_viewdef(v_view, true)) <> v_select || ' ' || v_supported_body || v_freshness_suffix then
    raise exception '0009 aborted: resulting definition is not the expected 0009 definition.';
  end if;
end
$migration$;

comment on view public.public_roles is
  'Publicly eligible roles: approved role and company, Active, deadline not passed, '
  'and successfully verified within the last 7 days (NULL last_verified_at hidden).';

-- Keeps the freshness predicate cheap for public reads.
create index if not exists idx_roles_public_freshness
  on public.roles (last_verified_at)
  where moderation_status = 'Approved' and listing_status = 'Active';

drop function pg_temp.lp_norm_viewdef(text);

notify pgrst, 'reload schema';

commit;