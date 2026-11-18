# Micron, HP and CVS careers sync

## Execution status and catch-up runs

The workflow runs every six hours. This repeats healthy sources and retries
eligible unfinished checks; existing per-job backoff dates remain in effect.
Muse stays enabled. An explicit access block or recorded incomplete download
is shown as `incomplete`, with a workflow warning and **DATA COVERAGE
INCOMPLETE** in the summary. It is not counted as fully synced and does not
refresh unseen jobs. Only handled availability problems get this treatment.
Database read/write failures, missing verification run records, programming
errors and stage timeouts still fail the workflow so they can be repaired.
No scraper can guarantee access to every outside site or all of its jobs.

The workflow uses the verified Node 24 versions of checkout and setup-node;
the application itself continues to run on Node 22.

## Employer feeds

Micron's and HP's configured Workday boards can return access challenges to the
scheduled sync. The shared sync engine now reads their published public careers
searches at https://careers.micron.com and https://apply.hp.com instead. Both
sites allow the public search route in robots.txt and use it in their careers UI.

The existing `micron.wd1.myworkdayjobs.com|micron|External` and
`hp.wd5.myworkdayjobs.com|hp|ExternalCareerSite` tokens select this adapter. No
migration, new credentials, or company reseeding is required.

CVS uses its official public careers search at https://jobs.cvshealth.com. The
existing `cvshealth.wd1.myworkdayjobs.com|cvshealth|CVS_Health_Careers` token
selects an adapter that reads the `intern` search, preserving that keyword on
every page. It parses the published embedded search data as JSON, without
executing page scripts, keeps the original `R…` requisition IDs and original
Workday Apply links, and fills city/state/country from the search records.
It never closes jobs outside the search. Other Workday employers continue
through their existing connector.

CVS's generic pagination links include `s=1`, which causes server-rendered
results to lose the keyword filter. The adapter deliberately omits that switch
and retains `keywords=intern` with each `from` offset. Unsupported postings are
reported as unmapped and do not prevent reading later pages.
The scheduled workflow gives CVS twelve minutes for its paced download; other
companies keep the existing eight-minute deadline. Short admin/API requests
keep their own existing deadlines and can return partial coverage.

The adapter uses the sites' published seniority filters: Micron Intern (`0`)
first, then Entry (`1`); HP internship and graduate. The shared title classifier
still decides which returned jobs are eligible for Launchpad.
It uses the site's Latest sort, follows start offsets to an empty page, and
spaces requests by 1.1 seconds. Overlapping results are deduplicated. Advertised
counts, malformed pages, repeated pages, interruptions and challenges are
reported as incomplete coverage; successfully observed jobs can still refresh.

The original `atsJobId` (`JR…`, `UNI…`, or numeric) remains the external job ID,
so existing company and requisition pairs update rather than duplicate.
Micron and HP Apply links point to the
official employer careers detail page. Descriptions remain empty, as with the
previous Workday board-list adapter.

This alternative careers feed confirms presence only: absent legacy Workday
jobs are never automatically closed from this feed. They keep their actual last
verification time and remain subject to the existing seven-day visibility rule
and separate verification checks. A complete download is labelled `filtered`
with this limitation in the run summary.

After committing and pushing the code and generated API bundles, start a new
Launchpad Aggregator Sync workflow on main. Check the Micron, HP and CVS rows' fetched,
eligible, refreshed and coverage values. This change does not remove access
blocks affecting Muse or other hosts. A successful local public-feed check does
not establish that GitHub's runner can access that host; check the new run's
coverage and error fields after release.
