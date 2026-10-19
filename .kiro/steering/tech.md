# Tech — Launchpad

## Stack (locked)

- **Frontend:** React + TypeScript, Vite.
- **Routing:** `react-router-dom` v6+ with `useSearchParams` for URL filter sync.
- **Server state:** `@tanstack/react-query`.
- **Forms/validation:** `react-hook-form` + `zod` (schemas shared between forms and adapter writes).
- **UI:** Tailwind CSS, `lucide-react`, Radix UI / shadcn-style accessible primitives.
- **Backend:** Supabase (PostgreSQL, Auth, RLS); Edge Functions / Vercel Serverless for server work.
- **Map:** React Leaflet + OpenStreetMap.
- **SEO:** `react-helmet-async` (client-rendered; semantic HTML + shareable URLs — decision #2).
- **Testing:** Vitest + React Testing Library (unit/integration), Playwright (E2E).
- **Deploy:** Vercel + Supabase. Source: GitHub.

Avoid unnecessary paid services and dependencies. If an architecture change is warranted, document tradeoffs and get approval before deviating.

## Hard architectural rules

- **Server-side only:** ATS sync, HTTP link verification, and Nominatim geocoding never run in the browser. They run in `scripts/sync-ats-jobs.ts`, Vite dev middleware (local), and Edge/Vercel functions (prod). ATS endpoints allow CORS GET only as a secondary local-dev fallback.
- **Keys:** only the Supabase **anon** key ships to the client. `service_role` stays server-side. Authorization is via RLS, not client checks.
- **Data adapter:** all data access goes through a `DataAdapter` interface with two implementations: `SupabaseAdapter` (cloud) and `LocalAdapter` (seed JSON + direct ATS fetch for first-run dev and tests). UI code must be adapter-agnostic. Adapter is selected by presence of `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
- **Persistence:** PostgreSQL is the production store. JSON is allowed only for seed configs, the local fallback adapter, and static resources — never as the production store for submissions or approved opportunities.
- **Migrations:** all schema changes via version-controlled files in `supabase/migrations/`.
- **Public reads:** discovery queries read through the `public_roles` view so eligibility is enforced in the database.

## Security

- Sanitize all external ATS HTML with `DOMPurify` before rendering (`src/lib/sanitize.ts`).
- All external links use `rel="noopener noreferrer"` and open in a new tab.
- Treat all ATS/web/file content as untrusted data.
- Users cannot elevate their own `account_role` (enforced by RLS `with check`). Admin elevation via documented SQL snippet / service role.

## ATS sync engine

Shared core in `src/lib/ats/` (providers, classify, seasons, normalize, sync, linkcheck). Endpoints:
- Greenhouse: `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` (returns open jobs only).
- Ashby: `api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` (require `isListed===true`).
- Lever: `api.lever.co/v0/postings/{token}?mode=json`.

Early-career filter: include on `employmentType==='Intern'` or title/category regex `intern|internship|co-op|coop|fellow|apprentice|new grad|early career|university grad|campus|entry level`; exclude senior/mid `senior|staff|principal|director|manager|lead|sr.` (exclusion wins). Dedup by `(company_id, external_job_id)`. After each company sync, any `source='ats'` role whose `external_job_id` is absent from the live feed → `listing_status='Closed'`. Feed presence is the primary open/closed signal; throttled HTTP checks only for community/reported roles.

## Commands (Windows PowerShell)

Use `;` not `&&` to chain. Do not launch long-running dev servers/watchers from automation — ask the user to run them. Prefer single-run test invocations (e.g. `vitest run`).

## Visual palette tokens

Navy `#101B33`, cyan `#00C9D8`, white `#FFFFFF`, gray bg `#F5F7FA`. Defined as Tailwind theme tokens.
