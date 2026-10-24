-- Midnight America/Los_Angeles, including daylight-saving changes.
-- Deploy /api/reverify-jobs first. This migration installs a DISABLED scheduler.
-- Then add launchpad_cron_secret to Vault and enable the settings row.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table if not exists public.job_reverification_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  worker_url text not null default 'https://launchpad-careers.vercel.app/api/reverify-jobs',
  next_run_at timestamptz not null default
    ((((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp) at time zone 'America/Los_Angeles'),
  last_request_id bigint,
  last_http_status integer,
  last_dispatch_error text
);
insert into public.job_reverification_settings (id) values (true) on conflict do nothing;

create table if not exists public.job_reverification_runs (
  run_date date primary key,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_companies integer not null default 0
);
create table if not exists public.job_reverification_tasks (
  run_date date not null references public.job_reverification_runs(run_date),
  company_id uuid not null references public.companies(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','running','succeeded','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  imported integer not null default 0,
  updated integer not null default 0,
  closed integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  finished_at timestamptz,
  primary key (run_date, company_id)
);
create index if not exists idx_reverification_pending
  on public.job_reverification_tasks (status, available_at, run_date);

alter table public.job_reverification_settings enable row level security;
alter table public.job_reverification_runs enable row level security;
alter table public.job_reverification_tasks enable row level security;
revoke all on public.job_reverification_settings, public.job_reverification_runs,
  public.job_reverification_tasks from public, anon, authenticated;
grant all on public.job_reverification_settings, public.job_reverification_runs,
  public.job_reverification_tasks to service_role;

create or replace function public.reverification_finalize_runs()
returns void language sql security definer set search_path = '' as $$
  update public.job_reverification_runs r
  set status = case when exists (
      select 1 from public.job_reverification_tasks t
      where t.run_date = r.run_date and t.status = 'failed'
    ) then 'completed_with_errors' else 'completed' end,
    completed_at = now()
  where r.status = 'running' and not exists (
    select 1 from public.job_reverification_tasks t
    where t.run_date = r.run_date and t.status in ('pending','running')
  );
$$;

create or replace function public.start_job_reverification(
  p_run_date date default (now() at time zone 'America/Los_Angeles')::date
)
returns date language plpgsql security definer set search_path = '' as $$
declare v_inserted integer;
begin
  perform pg_advisory_xact_lock(20261024, 6);
  insert into public.job_reverification_runs (run_date) values (p_run_date)
    on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    insert into public.job_reverification_tasks (run_date, company_id)
      select p_run_date, c.id from public.companies c
      where c.moderation_status = 'Approved' and c.ats_provider <> 'none'
        and nullif(btrim(c.ats_board_token), '') is not null;
    update public.job_reverification_runs r set total_companies = (
      select count(*) from public.job_reverification_tasks t where t.run_date = p_run_date
    ) where r.run_date = p_run_date;
  end if;
  perform public.reverification_finalize_runs();
  return p_run_date;
end;
$$;

create or replace function public.reverification_claim(p_limit integer default 8)
returns table (run_date date, company_id uuid, lease_token uuid, attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(20261024, 6);
  -- Recover work interrupted by a platform timeout or lost network response.
  update public.job_reverification_tasks t
    set status = case when t.attempts >= 3 then 'failed' else 'pending' end,
      available_at = now(), lease_until = null, lease_token = null,
      errors = '["Worker lease expired before completion."]'::jsonb,
      finished_at = case when t.attempts >= 3 then now() else null end
    where t.status = 'running' and t.lease_until <= now();
  return query
    with picked as (
      select t.run_date, t.company_id from public.job_reverification_tasks t
      where t.status = 'pending' and t.available_at <= now() and t.attempts < 3
      order by t.run_date, t.company_id
      for update skip locked limit greatest(1, least(coalesce(p_limit, 8), 8))
    )
    update public.job_reverification_tasks t
      set status = 'running', attempts = t.attempts + 1,
        lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
      from picked p where t.run_date = p.run_date and t.company_id = p.company_id
      returning t.run_date, t.company_id, t.lease_token, t.attempts;
  perform public.reverification_finalize_runs();
end;
$$;

create or replace function public.reverification_finish(
  p_run_date date, p_company_id uuid, p_lease_token uuid, p_result jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_task public.job_reverification_tasks%rowtype;
  v_errors jsonb := coalesce(p_result->'errors', '[]'::jsonb);
  v_warnings jsonb := coalesce(p_result->'warnings', '[]'::jsonb);
  v_ok boolean;
begin
  perform pg_advisory_xact_lock(20261024, 6);
  if jsonb_typeof(v_errors) <> 'array' or jsonb_typeof(v_warnings) <> 'array' then
    raise exception 'Result errors and warnings must be arrays';
  end if;
  select * into v_task from public.job_reverification_tasks t
    where t.run_date = p_run_date and t.company_id = p_company_id
      and t.lease_token = p_lease_token and t.status = 'running'
      and t.lease_until > now() for update;
  if not found then return false; end if;
  v_ok := jsonb_array_length(v_errors) = 0;
  update public.job_reverification_tasks t set
    status = case when v_ok then 'succeeded' when v_task.attempts >= 3 then 'failed' else 'pending' end,
    available_at = now() + interval '2 minutes',
    lease_until = null, lease_token = null,
    imported = greatest(0, coalesce((p_result->>'imported')::integer, 0)),
    updated = greatest(0, coalesce((p_result->>'updated')::integer, 0)),
    closed = greatest(0, coalesce((p_result->>'closed')::integer, 0)),
    errors = v_errors, warnings = v_warnings,
    finished_at = case when v_ok or v_task.attempts >= 3 then now() else null end
    where t.run_date = p_run_date and t.company_id = p_company_id;
  perform public.reverification_finalize_runs();
  return true;
end;
$$;

create or replace function public.dispatch_job_reverification()
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_settings public.job_reverification_settings%rowtype;
  v_secret text; v_request bigint; v_status integer; v_timed_out boolean;
  v_local_date date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if not pg_try_advisory_xact_lock(20261024, 6) then return null; end if;
  select * into v_settings from public.job_reverification_settings where id = true for update;
  if not found or not v_settings.enabled then return null; end if;
  -- Store only HTTP status, never a response body or a request header/secret.
  if v_settings.last_request_id is not null then
    select status_code, timed_out into v_status, v_timed_out
      from net._http_response where id = v_settings.last_request_id;
    if found then
      update public.job_reverification_settings set last_http_status = v_status,
        last_dispatch_error = case when v_timed_out then 'Worker HTTP request timed out; leases will recover.'
          when v_status >= 400 then 'Worker returned HTTP ' || v_status::text || '; check Vercel logs and queue errors.'
          else null end where id = true;
    end if;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name = 'launchpad_cron_secret' limit 1;
  if nullif(v_secret, '') is null then
    update public.job_reverification_settings set last_dispatch_error =
      'Add launchpad_cron_secret to Supabase Vault before enabling the scheduler.' where id = true;
    return null;
  end if;
  if v_settings.worker_url <> 'https://launchpad-careers.vercel.app/api/reverify-jobs' then
    raise exception 'Unexpected worker URL. Review the dispatcher before changing the production destination.';
  end if;
  if now() >= v_settings.next_run_at then
    -- Catch up the current local day if the database was unavailable at midnight.
    perform public.start_job_reverification(v_local_date);
    update public.job_reverification_settings set next_run_at =
      ((v_local_date + 1)::timestamp at time zone 'America/Los_Angeles') where id = true;
  end if;
  if exists (select 1 from public.job_reverification_tasks t where
      (t.status = 'pending' and t.available_at <= now()) or
      (t.status = 'running' and t.lease_until <= now())) then
    v_request := net.http_post(url := v_settings.worker_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
      body := '{}'::jsonb, timeout_milliseconds := 55000);
    update public.job_reverification_settings set last_request_id = v_request where id = true;
    return v_request;
  end if;
  perform public.reverification_finalize_runs();
  return null;
exception when others then
  -- No raw exception text: pg_net may include request details in its errors.
  update public.job_reverification_settings set last_dispatch_error =
    'Dispatcher failed. Check extension configuration and the worker URL.' where id = true;
  return null;
end;
$$;

revoke all on function public.reverification_finalize_runs() from public, anon, authenticated;
revoke all on function public.start_job_reverification(date) from public, anon, authenticated;
revoke all on function public.reverification_claim(integer) from public, anon, authenticated;
revoke all on function public.reverification_finish(date,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.dispatch_job_reverification() from public, anon, authenticated;
grant execute on function public.start_job_reverification(date), public.reverification_claim(integer),
  public.reverification_finish(date,uuid,uuid,jsonb) to service_role;
-- Replacing the same named job is idempotent. No credentials are stored in cron.job.
select cron.schedule('launchpad-midnight-reverification', '* * * * *',
  'select public.dispatch_job_reverification();');
notify pgrst, 'reload schema';
commit;
