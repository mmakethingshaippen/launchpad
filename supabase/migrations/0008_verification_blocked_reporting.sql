-- Blocked-access and retry reporting for aggregator verification runs.
--
-- Requires 0007_aggregator_verification.sql. Additive and safe to re-run.
-- Code written for this migration still runs without it: the run summary falls
-- back to the 0007 columns and logs that this file should be applied.
--
-- No role data changes here. Challenged attempts are recorded in the existing
-- 0007 role columns (reason prefix 'blocked:'); last_verified_at is untouched.
begin;

alter table public.aggregator_verification_runs
  -- Explicit access challenges (Cloudflare, AWS WAF, Akamai). Not included in failed.
  add column if not exists blocked integer not null default 0,
  -- Ready roles not attempted because their host kept serving challenges this run.
  add column if not exists host_blocked_skipped integer not null default 0,
  -- Waiting blocked roles tried anyway to see whether their host recovered.
  add column if not exists recovery_probes integer not null default 0,
  -- Waiting blocked roles of a recovered host whose retry time was cleared.
  add column if not exists retry_cleared integer not null default 0,
  -- Due roles with a future next_verification_at at run start / run end.
  add column if not exists retry_waiting_at_start integer not null default 0,
  add column if not exists retry_scheduled_at_end integer not null default 0,
  add column if not exists blocked_hosts text[] not null default '{}',
  add column if not exists recovered_hosts text[] not null default '{}',
  -- Per feed (external_job_id prefix) and destination host counts.
  add column if not exists by_source jsonb not null default '[]'::jsonb,
  -- This run's ingestion coverage per source (complete / partial / failed / blocked / disabled).
  add column if not exists feeds jsonb;

comment on column public.aggregator_verification_runs.waiting_retry is
  'Due roles waiting on next_verification_at when the run started (same as retry_waiting_at_start).';

notify pgrst, 'reload schema';

commit;