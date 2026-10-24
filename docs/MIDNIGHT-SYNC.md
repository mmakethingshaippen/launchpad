# Midnight Pacific job refresh

Supabase Cron starts a daily run at midnight in `America/Los_Angeles`, including daylight-saving changes. It checks for pending work every minute and calls the protected Vercel endpoint `/api/reverify-jobs`. The old Vercel cron entry is removed to avoid running both schedulers.

Each request claims up to eight companies and processes at most four concurrently. Database leases prevent two workers from claiming the same task. Interrupted requests recover after two minutes. A failed company gets up to three attempts, then remains visible as failed. Starting the same local date twice does not duplicate its queue.

The worker uses the existing connected ATS feeds. Aggregator-only listings, including Amazon listings ingested by the separate aggregator, are not reverified by this worker. Filtered or incomplete feeds refresh the jobs they return and record a warning; they never close absent jobs. Bulk database writes keep larger boards within the function deadline. A failed fetch or write never proves that a job closed.

## Setup order

1. In the Vercel project for `launchpad-careers.vercel.app`, check that these environment variables exist for **Production**: `CRON_SECRET`, `SUPABASE_URL` (or the existing `VITE_SUPABASE_URL`), and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key server-only; it must not have a `VITE_` prefix. Do not paste secret values into chat or commit them.
2. Build, commit, and push the replacement files. Wait for Vercel's production deployment to finish. Environment variable changes also require a new deployment.
3. In Supabase SQL Editor, run the complete `supabase/migrations/0006_midnight_reverification.sql` file. It creates the queue, restricted functions, and a disabled scheduler. It does not change the tracked-applications setup.
4. In Supabase Vault, create a secret with the name **`launchpad_cron_secret`**. Its value must be exactly the same as the Production `CRON_SECRET` in Vercel. Store the value through Vault's interface rather than in a repository file. If that named secret already exists, update it.
5. Run this in Supabase SQL Editor to enable scheduling for the next Pacific midnight:

```sql
update public.job_reverification_settings
set enabled = true,
    worker_url = 'https://launchpad-careers.vercel.app/api/reverify-jobs',
    next_run_at = (((now() at time zone 'America/Los_Angeles')::date + 1)::timestamp
                   at time zone 'America/Los_Angeles')
where id = true;
```

The minute scheduler is installed automatically. Do not add a second Vercel cron job or a second Supabase cron job for this worker.

## Start the first run immediately

In Windows PowerShell, replace `YOUR_CRON_SECRET` locally and run:

```powershell
curl.exe --fail-with-body --max-time 60 -X POST "https://launchpad-careers.vercel.app/api/reverify-jobs?start=1" -H "Authorization: Bearer YOUR_CRON_SECRET"
```

On macOS/Linux, use `curl` instead of `curl.exe` with the same arguments. The secret may remain in your terminal's command history; use a trusted local terminal.

`?start=1` creates today's Pacific-date queue once and immediately claims its first batch. With scheduling enabled, remaining batches continue automatically every minute. A response of `batch_complete` means that batch finished, not the entire company roster. A response of `idle` means there is no claimable work now: the run may already be complete, another worker may hold the leases, or retries may be waiting for their backoff.

To process another available batch manually without creating a new run:

```powershell
curl.exe --fail-with-body --max-time 60 -X POST "https://launchpad-careers.vercel.app/api/reverify-jobs" -H "Authorization: Bearer YOUR_CRON_SECRET"
```

`401` means the supplied secret does not match. `404` usually means the new route has not been deployed to this production URL. `500` means the SQL or server configuration needs attention. `503` with `needs_retry` means at least one company failed and its result was recorded for retry/review; the response includes the affected companies.

## Check progress

Run in Supabase SQL Editor:

```sql
select r.run_date, r.status, r.started_at, r.completed_at, r.total_companies,
       count(*) filter (where t.status = 'pending') as pending,
       count(*) filter (where t.status = 'running') as running,
       count(*) filter (where t.status = 'succeeded') as succeeded,
       count(*) filter (where t.status = 'failed') as failed
from public.job_reverification_runs r
left join public.job_reverification_tasks t on t.run_date = r.run_date
group by r.run_date
order by r.run_date desc
limit 7;

select run_date, company_id, status, attempts, errors, warnings
from public.job_reverification_tasks
where status = 'failed' or errors <> '[]'::jsonb or warnings <> '[]'::jsonb
order by run_date desc, company_id
limit 50;

select enabled, next_run_at,
       next_run_at at time zone 'America/Los_Angeles' as next_pacific_midnight,
       last_request_id, last_http_status, last_dispatch_error
from public.job_reverification_settings;
```

In Supabase Cron, the installed job is named `launchpad-midnight-reverification`. In Vercel runtime logs, filter for `/api/reverify-jobs`. The dispatcher stores HTTP status without storing response bodies or secret headers in the public queue tables. Vault and the pg_net internal request queue contain the service-to-service token and must remain restricted to trusted database administrators.

To stop future dispatches:

```sql
update public.job_reverification_settings set enabled = false where id = true;
```

This preserves the queue and history. A request already in progress can still finish.

## Local verification

Run `npm run build` to type-check the frontend and both serverless source files, build the frontend, and bundle `api/sync.js` and `api/reverify-jobs.js`. No API source file depends on browser code or unresolved TypeScript imports at runtime.

SQL was exercised with a local PostgreSQL runtime for queue behavior, permissions, retry limits, and spring/fall daylight-saving transitions. Hosted `pg_cron`, `pg_net`, and Vault interfaces were stubbed locally; the production scheduler and network request still need the setup steps above.
