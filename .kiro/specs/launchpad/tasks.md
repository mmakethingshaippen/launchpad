# Launchpad — Implementation Tasks

## Document Status

- **Phase:** Step 3 of 4 (Tasks)
- **State:** Draft — awaiting review
- **Depends on:** `requirements.md` ✅ approved, `design.md` ✅ approved (with refinements #1–#4)

## How to read this

Tasks are dependency-ordered and grouped by the 5 implementation phases. Each task lists a **Definition of Completion (DoC)** and the **Requirements** it satisfies (R# from `requirements.md`). Sub-tasks are checkable units. Refinements #1–#4 are called out inline where they land. Only coding tasks are included; manual review/deploy steps are noted where relevant.

Conventions: tests run against `LocalAdapter` with recorded fixtures (no cloud creds). Windows PowerShell — chain with `;`, use `vitest run` for single-run.

---

## Phase 1 — Foundation, Schema, ATS Sync Engine, Discovery

- [x] 1. Scaffold project and tooling
  - Initialize Vite + React + TypeScript; add Tailwind (palette tokens: navy `#101B33`, cyan `#00C9D8`, white, gray `#F5F7FA`), `react-router-dom`, `@tanstack/react-query`, `react-hook-form`, `zod`, `lucide-react`, Radix primitives, `react-helmet-async`, `dompurify`, Leaflet/react-leaflet.
  - Configure Vitest + React Testing Library and Playwright; add `vitest run` and `test:e2e` scripts.
  - Create `.env.example` (Supabase URL/anon key client vars; service role server-only var) and base folder structure per `structure.md`.
  - _DoC:_ `npm run build` succeeds; a trivial smoke test passes with `vitest run`; folder skeleton matches steering structure.
  - _Requirements:_ R22, R23, R26, R30

- [x] 2. Domain types and shared enums
  - Define TypeScript types/enums in `src/lib/adapter/types.ts` mirroring the DB enums (company_type, season, degree_level, listing_status, etc.) and the card/detail/filter DTOs.
  - Define `RoleFilters` type in `src/lib/filters.ts`.
  - _DoC:_ Types compile; season/degree/field unions match the spec exactly.
  - _Requirements:_ R22, R6

- [x] 3. Database schema migration
  - Write `supabase/migrations/0001_init.sql`: all enums, `companies`, `company_locations`, `roles` (incl. `search_tsv` generated column), `user_profiles`, `saved_opportunities`, `applications` (**incl. `application_url` and `follow_up_date` — refinement #2**), `moderation_history`, `listing_reports`.
  - Add constraints/indexes: unique `(company_id, external_job_id)`, dedup indexes for saved/applications, GIN on `seasons`/`degree_levels`/`fields`, GIN on `search_tsv`, deadline/moderation indexes. Add `updated_at` trigger and `user_profiles` auto-insert trigger.
  - _DoC:_ Migration applies cleanly to a local Postgres; a schema test asserts the key constraints/columns exist (incl. `applications.application_url`, `applications.follow_up_date`).
  - _Requirements:_ R12, R22

- [x] 4. `public_roles` view and RLS policies
  - Write `supabase/migrations/0002_rls.sql`: `public_roles` view (`security_invoker=on`) enforcing full eligibility rule.
  - **Refinement #1:** base-table `roles_public_read` policy filters on `moderation_status='Approved'` + approved parent company only (NOT `listing_status`), so closed/expired approved roles still load for the Closed banner; strict `listing_status='Active'` + `application_deadline >= current_date` live only in the view.
  - Add `is_admin()` security-definer fn; owner-only policies for saved/applications; no-self-elevation check on `user_profiles`; community-insert-forces-Pending; anon insert on `listing_reports`; admin-only on `moderation_history`.
  - _DoC:_ RLS tests prove: approved+closed role selectable from base table but excluded from `public_roles`; non-owner blocked from saved/apps; user cannot set `account_role='admin'`; community insert lands as Pending.
  - _Requirements:_ R9 (9.7–9.8), R12, R14, R16, R21

- [x] 5. Supabase client + DataAdapter interface + adapter selector
  - Define `DataAdapter` interface (per design §6.3). Implement selector in `src/lib/adapter/index.ts` choosing Supabase vs Local by env presence. Add `useAdapter` hook and provider.
  - _DoC:_ App boots in Local mode with no cloud creds; adapter type is satisfied by a stub.
  - _Requirements:_ R1, R23

- [x] 6. ATS provider adapters + normalization
  - Implement `src/lib/ats/providers/{greenhouse,ashby,lever}.ts` (`fetchPostings`, `toNormalized`) and `normalize.ts` producing `NormalizedPosting`. Enforce Ashby `isListed===true`.
  - Record provider JSON fixtures in `src/test/fixtures/`.
  - _DoC:_ Unit tests map each provider's fixture → `NormalizedPosting` with correct apply URL, location, workplace type, compensation; Ashby unlisted postings are dropped.
  - _Requirements:_ R17

- [x] 7. Classification + season/cohort logic
  - Implement `classify.ts` (`isEarlyCareer` with senior-exclusion precedence) and `seasons.ts` (`extractSeasons`, `cohortYear`, `nextOccurrenceYear`, `isConcluded`).
  - **Refinement #3:** `CUTOFF` uses `Date.UTC(y, m, d, 23,59,59)`.
  - _DoC:_ Unit tests cover: intern/co-op/new-grad inclusion; senior/staff/manager exclusion (incl. "Senior Intern" excluded); multi-season titles → multiple tags; no-season → `['Year-Round']`; past cohort year → concluded; boundary dates evaluated deterministically in UTC; no stated year → next occurrence not falsely rejected.
  - _Requirements:_ R18, R19 (19.1)

- [x] 8. Sync engine (upsert + close-missing + link validity)
  - Implement `sync.ts` `syncCompany()`: fetch → provider open-signal filter → `isEarlyCareer` → attach seasons/cohort → drop concluded → validate `apply_url` is HTTP(S) → upsert on `(company_id, external_job_id)` (ATS roles auto-Approved) → close roles absent from live feed. Implement `linkcheck.ts` (throttled HEAD/GET) used only for community/reported roles.
  - **Refinement #4:** `syncAll()` uses `Promise.allSettled` with bounded concurrency = 5 and per-request `AbortSignal.timeout(10000)`; returns a per-company summary; isolates failures.
  - _DoC:_ Integration tests (fixtures): new roles imported; re-sync updates not duplicates (dedup by external_job_id); role removed from feed → `listing_status='Closed'`; invalid apply URL rejected; one failing/slow provider does not abort the batch (allSettled summary shows the error).
  - _Requirements:_ R17, R19

- [x] 9. LocalAdapter (seed + direct ATS fetch)
  - Implement `LocalAdapter` backing all read methods from in-memory seed + sync output; wire dev-sync middleware (`server/dev-sync.ts`) exposing `/__sync`.
  - _DoC:_ `searchRoles`/`getRole`/`searchCompanies`/`getCompany`/`getStats`/`getFeatured` return correct data in Local mode; `/__sync` populates roles from fixtures/live feed.
  - _Requirements:_ R16, R23

- [x] 10. SupabaseAdapter read methods via `public_roles`
  - Implement discovery reads against `public_roles` (array-overlap season/degree/field filters, remote toggle, FTS keyword with `ts_rank` relevance sort, deadline/verified/name/recent sorts). Implement `getStats` (approved companies, active roles, approved startups) and `getFeatured`.
  - _DoC:_ Query-builder unit tests assert generated filters match semantics (OR within group, AND across groups); stats derive from DB (no hardcoding).
  - _Requirements:_ R2 (2.4–2.7), R6, R7, R8, R16

- [x] 11. Filter state ↔ URL hook
  - Implement `useRoleFilters` (parse/serialize to `useSearchParams`), including multi-select seasons, view toggle, sort, remote, degree, field, company type, stage, size.
  - _DoC:_ Unit tests: round-trip URL `?q=&season=summer,fall&type=internship&remote=1...` → filter object → URL; load-from-URL restores state.
  - _Requirements:_ R6 (6.4–6.5)

- [x] 12. UI primitives + layout + sanitize util
  - Build `ui/` primitives (Badge w/ season variants, Button, Select, Checkbox, Dialog, Drawer, Card, EmptyState, Spinner, RelativeTime), App layout (Nav/Footer), providers (Helmet/QueryClient/Adapter), and `src/lib/sanitize.ts` (DOMPurify).
  - _DoC:_ Primitives render; season badges visually distinct; sanitize strips scripts in a unit test.
  - _Requirements:_ R4 (4.4), R26, R27 (27.1)

- [x] 13. Home page
  - Hero (keyword, Season quick-select, location, Find Opportunities + Explore Startups), How It Works, live StatsBar, FeaturedGrid; search transfers to Browse via URL params; empty states for empty featured blocks.
  - _DoC:_ Integration test: submitting Home search navigates to `/browse` with params; stats read from adapter; no invented numbers.
  - _Requirements:_ R2

- [x] 14. Browse page (Opportunities default + Companies view)
  - FilterBar (season pills, sort, view toggle, active-filter chips, Clear All), FilterSidebar + mobile FilterDrawer, results header count (`aria-live`), OpportunitiesView (RoleCard) default, CompaniesView (CompanyCard w/ expandable roles respecting filters). No full-page reload on filter change.
  - _DoC:_ Integration tests for combined filters — seasons incl. Year-Round, startup-only, remote-only, paid-only, degree-level — plus chip removal, Clear All, empty state, view switch; result count accurate.
  - _Requirements:_ R3, R4, R5, R6, R7, R8

- [x] 15. Role Detail page
  - Full detail render, DOMPurify description, primary Apply (`target=_blank rel=noopener noreferrer`), Save/Track/Report secondary actions, SimilarRoles. **Refinement #1:** when loaded role is `Closed/Expired/Archived`, show the Closed banner + links to similar active roles (load succeeds because base RLS allows approved closed rows).
  - _DoC:_ Integration tests: active role shows Apply; closed role shows banner + similar roles (not a 404); report submits a `listing_reports` row; sanitized HTML.
  - _Requirements:_ R9, R27

- [x] 16. Company Profile page
  - Company header/meta, startup fields when verified, season-filterable active-role list, shareable URL, Add a Role link.
  - _DoC:_ Integration test: profile shows active roles filterable by season; zero-role company shows profile + `0 active roles` + careers link.
  - _Requirements:_ R5, R8, R10, R20 (20.4)

- [x] 17. Seed dataset + seed script
  - Author `src/data/seed-companies.ts` (≥30 real companies across all 6 fields, ≥10 startups) with verified `ats_provider`/`ats_board_token`, HQ coords, website/careers URLs. Implement `scripts/seed.ts` (insert approved companies → `syncAll`) and `scripts/sync-ats-jobs.ts` CLI. Seed dry-run flags any token returning non-200 (no fabricated fallback).
  - _DoC:_ Seed script runs against local Postgres and populates real roles; companies with 0 roles retained with `0 active roles`; seed report lists any bad tokens.
  - _Requirements:_ R17, R19, R20

- [x] 18. SEO metadata for public pages
  - Add `react-helmet-async` titles + OpenGraph to Home, Browse, RoleDetail, CompanyProfile; semantic HTML landmarks.
  - _DoC:_ Tests assert dynamic `<title>`/OG tags per route; stable shareable URLs.
  - _Requirements:_ R24

---

## Phase 2 — Auth, Saving, Application Tracking

- [x] 19. Auth integration
  - Supabase Auth sign-up/in/out, `useAuth`, `AuthProvider`; `user_profiles` row created on sign-up with `account_role='student'`.
  - _DoC:_ Auth flows work in cloud mode; mocked in Local; browsing never gated.
  - _Requirements:_ R1, R21

- [x] 20. Saving + tracking (local + cloud) via adapter
  - Implement `listSaved/save/unsave` and `listApplications/upsertApplication` in both adapters (localStorage keys for anon, Supabase for registered). My Applications dashboard: separate Saved vs Applications, status board (`Applied/Interviewing/Offer/Rejected`), **surface `follow_up_date` upcoming/overdue and `application_url` (refinement #2)**.
  - _DoC:_ Integration tests: anon save/track in localStorage; registered save/track in Supabase (RLS owner-only); dashboard shows follow-up due/overdue states.
  - _Requirements:_ R12, R21

- [x] 21. Local→account migration with dedup
  - Implement `migrateLocalToAccount()` on sign-in: dedup saved by `(user_id, role_id)`; applications by `(user_id, role_id)` or `(user_id, lower(company), lower(title))` for manual entries; clear local keys after migrate; idempotent on repeat sign-ins.
  - _DoC:_ Unit/integration tests prove no duplicates created on migration or repeated sign-ins.
  - _Requirements:_ R12

---

## Phase 3 — Submissions, Admin, Geocoding, Sync Controls

- [x] 22. Submit page (Form A + Form B)
  - Two zod-validated forms (company + role) with honeypot; submissions set `moderation_status='Pending'`; silent reject on honeypot fill.
  - _DoC:_ Integration tests: invalid input shows field errors; valid submit creates Pending record; honeypot-filled submit silently dropped; pending not visible in public search.
  - _Requirements:_ R14

- [x] 23. Admin guard + moderation dashboard
  - `RequireAdmin` route guard; PendingQueue to approve/reject/edit companies and roles writing `moderation_history`; ReportsPanel for `listing_reports`.
  - _DoC:_ Integration tests: non-admin blocked from `/admin` and admin ops; approve/reject writes history; approved record becomes publicly visible.
  - _Requirements:_ R15, R21

- [x] 24. Geocoding helper + admin geocode panel
  - `src/lib/geocode.ts` wrapping Nominatim (descriptive User-Agent, 1 req/sec queue); admin GeocodePanel resolves + stores lat/lng into `company_locations` at approval time.
  - _DoC:_ Unit test: queue throttles to 1/sec and caches; coords persisted; never invoked on public page load.
  - _Requirements:_ R11 (11.4), R15 (15.4)

- [x] 25. On-demand sync controls (admin) + production function
  - SyncPanel in `/admin` (single company + batch all) calling the server sync; implement `api/sync.ts` (Vercel serverless) mirroring the shared core; **refinement #4** concurrency/timeout applied.
  - _DoC:_ Integration test (mocked server): single + batch sync return per-company summaries; `last_verified_at` updated; removed roles auto-closed; slow provider isolated.
  - _Requirements:_ R15, R17, R19

---

## Phase 4 — Map and Resources

- [x] 26. Interactive Map page
  - React Leaflet + OSM, marker clustering, zoom/pan, company preview cards linking to profile/active roles; retains Browse filters (season/startup); markers only for geocoded locations; remote roles discoverable without physical marker.
  - _DoC:_ Tests: marker rendered only when lat/lng present; remote role not mislocated; filters carried from Browse.
  - _Requirements:_ R11

- [x] 27. Resources guides
  - Four guides (Resume Tips, Interview Prep, Finding Unlisted Internships incl. startups/off-cycle terms, Evaluating an Offer) at shareable URLs with semantic content.
  - _DoC:_ Routes render each guide; accessible headings; shareable URLs.
  - _Requirements:_ R13

---

## Phase 5 — SEO/A11y, Testing, Security, Deployment

- [x] 28. Accessibility pass
  - Keyboard operability of search/filters/cards/actions, labeled controls incl. icon-only buttons, focus-visible, `aria-live` counts, loading/empty states.
  - _DoC:_ RTL a11y tests for keyboard nav and labels pass; note that full WCAG conformance needs manual AT review.
  - _Requirements:_ R25

- [x] 29. End-to-end tests
  - Playwright: Home→Browse→filter→RoleDetail→Apply (new tab), save/track, submit flow, admin guard, map marker accuracy.
  - _DoC:_ E2E suite passes against Local mode in CI.
  - _Requirements:_ R28

- [x] 30. Security review + hardening
  - Verify no `service_role` in client bundle, all external links `rel=noopener noreferrer`, all ATS HTML sanitized, RLS coverage on every table, inputs validated.
  - _DoC:_ Checklist verified; bundle grep shows no service key; RLS tests green.
  - _Requirements:_ R21, R27, R16

- [x] 31. Deployment docs + config
  - `README.md` (setup, local fallback, env, migrations order, seed + initial sync, admin-elevation SQL snippet), finalize `.env.example`, Vercel config, optional cron for scheduled sync.
  - _DoC:_ README lets a new dev run locally with no cloud creds and deploy to Vercel+Supabase; admin snippet documented.
  - _Requirements:_ R30

---

## Traceability recap

Every requirement R1–R30 is referenced by at least one task above. Refinements: #1 → tasks 4 & 15; #2 → tasks 3 & 20; #3 → task 7; #4 → tasks 8 & 25.
