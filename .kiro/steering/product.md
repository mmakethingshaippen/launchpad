# Product — Launchpad

Launchpad helps undergraduate students, graduate students, and recent graduates discover legitimate, currently open internships, co-ops, and early-career roles at startups and established companies.

## Non-negotiable product rules

- **Zero expired listings.** Only show roles that are verified open right now. A role is publicly eligible only when: role `moderation_status='Approved'`, parent company `moderation_status='Approved'`, role `listing_status='Active'`, and (`application_deadline IS NULL` OR `>= CURRENT_DATE`). Enforce this at the DB level (the `public_roles` view + RLS), never only in the UI.
- **Never fabricate data.** No invented roles, salaries, deadlines, coordinates, statistics, startup stage/size, or logos. Unknown stays unknown and must be visually distinguishable from verified data.
- **No account required to browse or apply.** Accounts are optional and only add saving + application tracking. Anonymous users get the same features backed by `localStorage`.
- **Live sourcing only.** Roles come from live public ATS feeds (Greenhouse, Ashby, Lever) or community submissions that pass moderation — not static historical seed roles.
- **~30-second journey.** Optimize Home → Search → Filter → Role → Apply. Apply opens the employer's verified live page in a new tab with `rel="noopener noreferrer"`.

## Seasons / terms

Canonical set: `Spring`, `Summer`, `Fall`, `Winter`, `Year-Round`. Roles carry a `seasons` array. Season cutoffs (end of cohort occurrence): Winter→Mar 31, Spring→May 31, Summer→Aug 31, Fall→Dec 15. `cohort_year < CURRENT_YEAR` ⇒ expired. No stated cohort year ⇒ assume next upcoming occurrence so live postings aren't falsely rejected.

## Startups are first-class

Startups get equal visibility: startup-only filtering, browse by industry/stage/size, show stage/size/founding year when verified. Keep a startup's careers link available even when it has 0 open roles. Do not infer funding stage from company size.

## Primary journeys

1. Discover → filter → view → apply (anonymous-friendly).
2. Save + track applications (anonymous via localStorage, or synced account).
3. Community submit company/role → admin moderation.

## Source of truth

`.kiro/specs/launchpad/requirements.md` (EARS criteria) and `design.md`. When in doubt, follow those documents.
