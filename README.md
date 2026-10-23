# Launchpad

**Your career starts somewhere. Find your Launchpad.**

Launchpad helps undergraduate students, graduate students, and recent graduates discover **legitimate, currently open** internships, co-ops, and early career roles at startups and established companies. Every listing is verified against live employer ATS feeds, so students never waste time on expired postings.

- **Zero expired listings** — eligibility is enforced in the database via a Postgres view + RLS.
- **No account required** to browse or apply. Accounts are optional and only add saving + application tracking.
- **Startups are first-class** — filter by startup, stage, size, and industry.
- **Live sourcing** — roles come from public Greenhouse, Ashby, and Lever feeds, never fabricated.

---

## Tech stack

| Area | Choice |
|---|---|
| Frontend | React + TypeScript, Vite |
| Routing | `react-router-dom` v6 (URL-synced filters) |
| Server state | `@tanstack/react-query` |
| Validation | `zod` |
| UI | Tailwind CSS, `lucide-react`, custom accessible primitives |
| Backend | Supabase (PostgreSQL, Auth, RLS) |
| Map | React Leaflet + OpenStreetMap |
| SEO | `react-helmet-async` |
| Sanitization | `DOMPurify` |
| Testing | Vitest + React Testing Library (unit/integration), Playwright (E2E) |
| Deploy | Vercel + Supabase |

---

## Architecture at a glance

```
Browser (React SPA)
  └── DataAdapter interface
        ├── LocalAdapter    → in-memory seed + direct ATS fetch (dev/tests, no cloud creds)
        └── SupabaseAdapter → reads via the public_roles view, RLS-enforced

Server-side only (never in the browser bundle)
  ├── scripts/sync-ats-jobs.ts   (CLI sync / cron)
  ├── scripts/seed.ts            (seed verification dry-run)
  ├── server/dev-sync.ts         (Vite /__sync middleware, local dev)
  └── api/sync.ts                (Vercel serverless, service-role, admin-gated)
```

The app picks its adapter automatically: if `VITE_SUPABASE_URL` **and** `VITE_SUPABASE_ANON_KEY` are set it uses Supabase; otherwise it runs fully in **LocalAdapter mode** (seed data + live ATS fetch) with no cloud credentials — great for first-run and CI.

**Security boundaries**
- Only the Supabase **anon** key ships to the browser. Authorization is via RLS.
- The **service role** key is used only server-side (`api/sync.ts`).
- All external ATS HTML is sanitized with DOMPurify before render.
- All external links use `target="_blank" rel="noopener noreferrer"`.

---

## Quick start (local, no cloud needed)

```bash
npm install
cp .env.example .env     # optional; leave Supabase vars blank for local mode
npm run dev              # http://localhost:5173
```

In local mode the app fetches live public ATS feeds directly and renders real open roles from the seed companies.

### Verify seed ATS tokens

```bash
npm run seed             # dry-run: fetches every seed company's feed, reports reachability
```

This never fabricates roles — it reports which tokens return open early-career roles and flags any that fail.

### Run a sync from the CLI

```bash
npm run sync             # sync all seed companies
npm run sync -- stripe   # sync one company by slug
```

---

## Testing

```bash
npm test                 # unit + integration (Vitest), runs with no cloud creds
npm run test:watch       # watch mode
npm run test:e2e         # Playwright E2E (builds + serves with VITE_E2E=1)
```

- Unit/integration tests run against `LocalAdapter` with recorded ATS fixtures — **no network or cloud required**.
- DB/RLS assertion tests run in full only when `DATABASE_URL` (or `VITE_SUPABASE_URL`) is set; otherwise they skip cleanly.
- E2E seeds deterministic roles (`VITE_E2E=1`) so the suite never depends on live feeds.

---

## Environment variables

See [`.env.example`](./.env.example). Summary:

| Variable | Scope | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | client | Supabase project URL (enables cloud mode) |
| `VITE_SUPABASE_ANON_KEY` | client | Supabase anon key (RLS-enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Privileged upserts during sync/moderation |
| `DATABASE_URL` | server/tests | Optional; enables DB-backed tests |
| `NOMINATIM_USER_AGENT` | server | Descriptive UA for OSM geocoding |

Never expose the service role key in client code or commit a real `.env`.

---

## Supabase setup

1. Create a Supabase project.
2. Apply migrations in order (Supabase SQL editor, or the Supabase CLI):

   ```
   supabase/migrations/0001_init.sql   # enums, tables, indexes, triggers
   supabase/migrations/0002_rls.sql    # public_roles view + RLS policies
   ```

3. Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (client) and `SUPABASE_SERVICE_ROLE_KEY` (server) in your environment.
4. Seed companies and run the first sync (service-role context), then populate roles from live feeds.

### Elevate the first admin

After the admin user signs up through the app, run this once (SQL editor / service role):

```sql
update public.user_profiles
set account_role = 'admin'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

See also [`supabase/ADMIN.sql`](./supabase/ADMIN.sql). RLS prevents users from elevating themselves; admin elevation must be done with the service role.

---

## Data model

Normalized PostgreSQL schema (see `supabase/migrations/0001_init.sql`):

- **companies**, **company_locations**, **roles** (with a `search_tsv` full-text column, GIN indexes on `seasons`/`degree_levels`/`fields`, and a unique `(company_id, external_job_id)` constraint for ATS dedup)
- **user_profiles** (`account_role`, auto-created on sign-up)
- **saved_opportunities**, **applications** (with `application_url` + `follow_up_date`, composite dedup indexes)
- **moderation_history**, **listing_reports**

### Public eligibility rule (zero-expired guarantee)

A role is publicly visible only when:

```
role.moderation_status = 'Approved'
AND company.moderation_status = 'Approved'
AND role.listing_status = 'Active'
AND (role.application_deadline IS NULL OR role.application_deadline >= CURRENT_DATE)
```

This is enforced by the `public_roles` view (used for all search/browse/featured reads). The base-table RLS policy intentionally allows reading *approved but closed* roles so a shared link to a recently-closed role can still render a "no longer accepting applications" banner.

---

## Live ATS sync engine

Shared core in `src/lib/ats/` (providers, classifier, season parser, sync). For each company it:

1. Fetches the public feed (Greenhouse / Ashby `isListed` / Lever).
2. Keeps **early-career** roles only (intern/co-op/new-grad regex; excludes senior/staff/manager/etc.).
3. Tags **seasons** from title/description (multi-season supported; defaults to `Year-Round`).
4. Rejects **concluded cohorts** using UTC cutoffs (Winter Mar 31, Spring May 31, Summer Aug 31, Fall Dec 15; past cohort year ⇒ expired; no stated year ⇒ next occurrence).
5. Upserts by `(company_id, external_job_id)` and **auto-closes** roles no longer present in the feed.

Batch `syncAll()` runs with bounded concurrency (5) and a per-request 10s timeout so one slow endpoint never stalls the batch.

---

## Deployment (Vercel + Supabase)

1. Push to GitHub and import the repo into Vercel.
2. Set environment variables in Vercel:
   - Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Server: `SUPABASE_SERVICE_ROLE_KEY` (and `VITE_SUPABASE_URL`)
3. Vercel builds the SPA and deploys `api/sync.ts` as a serverless function.
4. Apply Supabase migrations and elevate your admin user.
5. (Optional) Add a Vercel Cron job to POST `/api/sync` on a schedule to keep `last_verified_at` fresh and auto-close stale roles.

---

## Project structure

```
api/                 Vercel serverless (sync)
e2e/                 Playwright specs
scripts/             sync + seed CLIs
server/              Vite dev-sync middleware
src/
  components/        ui primitives, layout, cards, guards
  data/              seed companies, resource guides
  hooks/             useAdapter, useAuth, useRoleFilters, useSaved, useApplications
  lib/
    adapter/         DataAdapter + Local/Supabase implementations + mappers
    ats/             providers, classify, seasons, normalize, sync
    filters, sanitize, geocode, migrate, roleQuery, followUp
  pages/             Home, Browse, RoleDetail, CompanyProfile, MapPage,
                     Resources, MyApplications, Submit, Admin
  test/              fixtures, harness, schema/security suites
supabase/migrations/ versioned SQL (schema + RLS)
```

---

## Accessibility & SEO

- Semantic landmarks, a skip-to-content link, and `aria-live` result counts.
- Keyboard-operable filter drawer (Escape/overlay dismiss) and labelled controls.
- Per-page titles + OpenGraph via `react-helmet-async`; stable, shareable URLs.

> Full WCAG conformance requires manual testing with assistive technology and expert review; automated checks alone are not sufficient.

---

## License

For educational/demonstration use. Opportunity data belongs to the respective employers and their ATS providers.
