-- Read-only coverage and verification checks. Safe to run in the Supabase SQL editor.
-- Tested for syntax against migrations 0001-0009 (PGlite).
-- C1. Visible jobs by source and provider
select pr.source, coalesce(c.ats_provider::text, 'none') as provider, count(*) as visible
from public.public_roles pr join public.companies c on c.id = pr.company_id
group by rollup (pr.source, coalesce(c.ats_provider::text, 'none'))
order by pr.source nulls last, visible desc;
-- C2. Employers: visible vs hidden (awaiting verification) vs recorded failures
select c.slug, coalesce(c.ats_provider::text, 'none') as provider,
       coalesce(v.visible, 0) as visible,
       count(*) filter (where r.last_verified_at is null or r.last_verified_at < now() - interval '7 days') as hidden_awaiting_verification,
       count(*) filter (where r.last_verification_failure_reason is not null) as with_recorded_failure
from public.roles r
join public.companies c on c.id = r.company_id
left join (select company_id, count(*) as visible from public.public_roles group by company_id) v on v.company_id = c.id
where r.listing_status = 'Active' and r.moderation_status = 'Approved' and c.moderation_status = 'Approved'
group by c.slug, c.ats_provider, v.visible
order by hidden_awaiting_verification desc, visible desc
limit 40;
-- C3. Visible jobs by role category
select field, opportunity_type, count(*) as visible from public.public_roles group by 1, 2 order by 3 desc;
-- C4. Visible jobs by location
select case when work_arrangement = 'Remote' then 'Remote'
            else coalesce(nullif(state, ''), nullif(country, ''), 'unknown') end as location,
       count(*) as visible
from public.public_roles group by 1 order by 2 desc limit 30;
-- C5. Recorded verification failures by source, provider and reason (Active jobs)
select r.source, coalesce(c.ats_provider::text, 'none') as provider, r.last_verification_failure_reason as reason, count(*) as jobs,
       min(r.last_verification_failure_at) as first_seen, max(r.last_verification_failure_at) as last_seen
from public.roles r join public.companies c on c.id = r.company_id
where r.listing_status = 'Active' and r.last_verification_failure_reason is not null
group by 1, 2, 3 order by 4 desc;
-- C6. Active jobs by apply-URL host (explains employer-confirmation "skipped" counts)
select substring(apply_url from '^https?://(?:www\.)?([^/?#]+)') as host, source, count(*) as active_jobs
from public.roles where listing_status = 'Active' group by 1, 2 order by 3 desc limit 30;
-- C7. Possible duplicate jobs: same company and same URL (query and trailing slash ignored)
select c.slug, lower(regexp_replace(split_part(r.apply_url, '?', 1), '/+$', '')) as url, count(*) as active_rows,
       array_agg(r.source || ':' || r.id::text order by r.source) as rows
from public.roles r join public.companies c on c.id = r.company_id
where r.listing_status = 'Active'
group by c.slug, 2 having count(*) > 1 order by 3 desc limit 50;
-- C8. Existing records for the proposed employers (run before seeding)
select c.slug, c.name, c.source, c.ats_provider, c.ats_board_token, c.moderation_status,
       (select count(*) from public.roles r where r.company_id = c.id and r.listing_status = 'Active') as active_roles
from public.companies c
where c.slug in ('sharkninja', 'astranis', 'the-new-york-times', 'astera-labs', 'base-power', 'shield-ai')
   or c.name ilike any (array['%sharkninja%', '%astranis%', '%new york times%', '%astera%', '%base power%', '%shield ai%']);
-- C9. Why the c4690c5 Workday recheck found zero candidates. It required: Active, a company with
-- ats_provider = 'workday', last_verified_at NOT NULL and older than 45 minutes before the recheck,
-- and an apply URL containing /job/ (unmappable rows were dropped before counting). The recheck in
-- run 43616572523 attempt 2 started between 22:05 and 22:10 UTC, so 21:20 UTC is used as the cutoff.
select r.source,
       case when r.last_verified_at is null then 'NULL (never matched lt)'
            when r.last_verified_at >= timestamptz '2026-11-14 21:20:00+00' then 'verified within 45 min (excluded)'
            else 'older (would be a candidate)' end as verified_bucket,
       (r.apply_url like '%/job/%') as mappable_url,
       count(*) as active_jobs,
       min(r.last_verified_at) as oldest, max(r.last_verified_at) as newest
from public.roles r join public.companies c on c.id = r.company_id
where r.listing_status = 'Active' and c.ats_provider = 'workday' and c.ats_board_token is not null
group by 1, 2, 3 order by 1, 2, 3;
-- C10. Unmapped Workday recheck candidates by employer and URL pattern (mirrors workdayUnmappedReason).
select c.slug, r.source,
       case when r.apply_url is null then 'no apply url'
            when r.apply_url !~* '^https?://[^/]*myworkday(jobs|site)\.com' then 'non-workday host ' || substring(r.apply_url from '^https?://(?:www\.)?([^/?#]+)')
            when r.apply_url ~* 'myworkdayjobs\.com'
                 and lower(substring(r.apply_url from '^https?://([^./]+)\.')) <> lower(split_part(c.ats_board_token, '|', 2))
              then 'other workday tenant ' || substring(r.apply_url from '^https?://([^./]+)\.')
            when r.apply_url !~ '/job/' then 'workday url without /job/ path'
            else 'mappable' end as reason,
       count(*) as active_jobs
from public.roles r join public.companies c on c.id = r.company_id
where r.listing_status = 'Active' and c.ats_provider = 'workday' and c.ats_board_token is not null
group by 1, 2, 3 order by 4 desc;

-- C11. Workday ATS jobs closed by sync, by employer and day. Before 650563a's successor, 14 Workday
-- tenants were read only 40 jobs per run and reported complete, so sync could close jobs still on
-- the board. Jobs the fixed sync finds on the board are reopened by the next upsert.
select c.slug, date_trunc('day', r.updated_at) as day, count(*) as closed_jobs
from public.roles r join public.companies c on c.id = r.company_id
where r.source = 'ats' and r.listing_status = 'Closed' and c.ats_provider = 'workday'
  and r.updated_at > now() - interval '30 days'
group by 1, 2 order by 2 desc, 3 desc;

-- C12. Were the prepared employer additions seeded? (rows with these tokens mean yes)
select slug, ats_provider, ats_board_token, source, moderation_status, updated_at
from public.companies
where (ats_provider::text, ats_board_token) in (('greenhouse', 'sharkninjaoperatingllc'), ('greenhouse', 'astranis'),
       ('greenhouse', 'thenewyorktimes'), ('greenhouse', 'asteraearlycareer2027'), ('ashby', 'base-power'), ('ashby', 'shield'));