# Launchpad — Design

## Document Status

- **Phase:** Step 2 of 4 (Design)
- **State:** Draft — awaiting review
- **Depends on:** `requirements.md` (approved)
- **Locked decisions (from review):**
  1. ATS sync + link checks run **server-side only** (CLI, dev middleware, Edge/Serverless Functions). ATS endpoints also allow CORS GET as a secondary local-dev fallback.
  2. SEO via client-rendered `react-helmet-async` + semantic HTML + shareable URLs.
  3. Feed presence is the primary open/closed signal; throttled HTTP HEAD/GET only for community/reported roles.
  4. Season cutoffs: Winter→Mar 31, Spring→May 31, Summer→Aug 31, Fall→Dec 15 (of cohort year). `cohort_year < CURRENT_YEAR` ⇒ expired. No stated cohort ⇒ assume next upcoming occurrence.
  5. Admin bootstrap via documented SQL snippet.
  6. On-demand Nominatim geocoding in `/admin`, descriptive User-Agent, 1 req/sec, store lat/lng.
  7. Vitest + React Testing Library (unit/integration), Playwright (E2E).

---

## 1. System Architecture

### 1.1 High-level view

Launchpad is a React + TypeScript SPA (Vite) talking to a Supabase (PostgreSQL + Auth) backend. All privileged and cross-origin work (ATS sync, link verification, geocoding) runs server-side. A local fallback adapter lets the app and tests run with no cloud credentials.

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser (React SPA — Vite)                                         │
│  Pages: Home, Browse, RoleDetail, CompanyProfile, Map, Resources,  │
│         MyApplications, Submit, Admin                               │
│  State: React Query (server cache) + URL params + localStorage     │
│  Data access: DataAdapter interface                                │
│     ├── SupabaseAdapter  (anon key, RLS-enforced reads/writes)     │
│     └── LocalAdapter     (seed JSON + direct ATS fetch, dev/tests)  │
└───────────────┬───────────────────────────────┬────────────────────┘
                │ (anon key, RLS)                │ (dev only)
                ▼                                ▼
┌───────────────────────────┐      ┌──────────────────────────────────┐
│ Supabase                  │      │ Server-side sync runtime          │
│  - PostgreSQL + RLS       │      │  - scripts/sync-ats-jobs.ts (CLI) │
│  - Auth                   │◀────▶│  - Vite dev middleware (local)    │
│  - public_roles VIEW      │ svc  │  - Edge/Vercel fn (prod)          │
│  - RPC (stats, search)    │ role │     → fetch Greenhouse/Ashby/Lever│
└───────────────────────────┘      │     → classify, season-parse      │
                                    │     → upsert, close-missing       │
                                    │  - Nominatim geocode (admin)      │
                                    └──────────────────────────────────┘
```

### 1.2 Trust boundaries

- **Browser** uses only the Supabase **anon** key. All data authorization is via RLS. The `service_role` key never ships to the client.
- **Server-side runtime** (CLI / Edge / Vercel fn) uses the `service_role` key (or a dedicated sync role) for upserts and to bypass RLS during sync/moderation jobs.
- **External content** (ATS HTML) is untrusted → sanitized with DOMPurify before render.

### 1.3 Runtime modes

| Mode | Data source | ATS fetch | Auth | Used for |
|---|---|---|---|---|
| Local fallback | `LocalAdapter` (seed JSON in memory/IndexedDB) | direct fetch via dev middleware (or CORS GET) | mocked/none | first-run dev, unit/integration tests |
| Cloud | `SupabaseAdapter` | Edge/Vercel fn | Supabase Auth | staging/production |

The adapter is selected at bootstrap: if `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present → Supabase; otherwise → Local. The interface is identical so UI code is mode-agnostic.

### 1.4 Server-side sync runtime detail

One shared core library (`src/lib/ats/`) is imported by all three entry points so logic is written once:

- `scripts/sync-ats-jobs.ts` — Node CLI (`tsx`), used for seeding and cron.
- Vite dev middleware (`server/dev-sync.ts`) — exposes `/__sync` locally so the SPA can trigger sync without cloud.
- Production function (`api/sync.ts` on Vercel, or a Supabase Edge Function) — called by `/admin`.

---

## 2. Data Model (PostgreSQL)

All tables live in `public`. Enums are Postgres enums for integrity. Timestamps are `timestamptz` with `now()` defaults; `updated_at` maintained by a trigger.

### 2.1 Enums

```sql
create type company_type       as enum ('Startup','Established Company','Other / Unknown');
create type startup_stage      as enum ('Pre-seed','Seed','Series A','Series B','Series C or later','Bootstrapped','Unknown / Not disclosed');
create type employee_range      as enum ('1-10','11-50','51-200','201-500','501+');
create type ats_provider        as enum ('greenhouse','lever','ashby','none');
create type moderation_status   as enum ('Pending','Approved','Rejected');
create type listing_status      as enum ('Active','Expired','Closed','Archived');
create type work_arrangement    as enum ('Remote','Hybrid','Onsite');
create type opportunity_type    as enum ('Internship','Co-op','Entry-level / New-grad');
create type work_schedule       as enum ('Full-time','Part-time');
create type compensation_status as enum ('Paid','Unpaid','Not disclosed');
create type degree_level        as enum ('Undergraduate','Graduate','New Grad');
create type season              as enum ('Spring','Summer','Fall','Winter','Year-Round');
create type field_type          as enum ('Technology','Business','Healthcare','Engineering','Finance','Marketing','Other');
create type location_type       as enum ('HQ','Office');
create type account_role        as enum ('student','admin');
create type application_status  as enum ('Applied','Interviewing','Offer','Rejected');
```

> Arrays of enums are used where the model specifies array columns (`fields`, `degree_levels`, `seasons`).

### 2.2 Tables

**companies**

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| name | text not null | |
| slug | text unique not null | url-safe, generated |
| logo_url | text | nullable |
| website_url | text | |
| careers_url | text | |
| description | text | |
| fields | field_type[] not null default '{}' | |
| company_type | company_type not null default 'Other / Unknown' | |
| startup_stage | startup_stage | nullable |
| employee_count_range | employee_range | nullable |
| founding_year | int | nullable; check 1800..current+1 |
| degree_levels | degree_level[] not null default '{}' | |
| ats_provider | ats_provider not null default 'none' | |
| ats_board_token | text | nullable |
| source | text not null default 'seed' | 'seed' \| 'community' \| 'ats' |
| moderation_status | moderation_status not null default 'Pending' | |
| last_verified_at | timestamptz | |
| created_at / updated_at | timestamptz | |

**company_locations**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id | uuid fk→companies on delete cascade | |
| city / state / country | text | |
| latitude / longitude | double precision | nullable until geocoded |
| location_type | location_type not null default 'HQ' | |

**roles**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| company_id | uuid fk→companies on delete cascade | |
| slug | text unique not null | |
| external_job_id | text | nullable; ATS id |
| title | text not null | |
| field | field_type not null default 'Other' | |
| seasons | season[] not null default '{Year-Round}' | |
| cohort_year | int | nullable |
| city / state / country | text | nullable (remote) |
| work_arrangement | work_arrangement not null default 'Onsite' | |
| degree_levels | degree_level[] not null default '{}' | |
| opportunity_type | opportunity_type not null default 'Internship' | |
| work_schedule | work_schedule not null default 'Full-time' | |
| compensation_status | compensation_status not null default 'Not disclosed' | |
| pay_min / pay_max | numeric | nullable |
| pay_currency | text | nullable (ISO 4217) |
| pay_period | text | 'hour'\|'month'\|'year' nullable |
| duration | text | nullable |
| application_deadline | date | nullable |
| apply_url | text not null | |
| description | text | sanitized HTML or text |
| source | text not null default 'community' | 'seed'\|'community'\|'ats' |
| source_url | text | |
| moderation_status | moderation_status not null default 'Pending' | |
| listing_status | listing_status not null default 'Active' | |
| last_verified_at | timestamptz | |
| search_tsv | tsvector | generated (title+description) |
| created_at / updated_at | timestamptz | |

Constraints & indexes:

```sql
alter table roles add constraint uq_roles_company_external
  unique (company_id, external_job_id);          -- NULLs are distinct in PG, so multiple NULLs allowed
create index gin_roles_fields       on roles using gin (seasons);
create index gin_roles_degrees      on roles using gin (degree_levels);
create index gin_companies_fields   on companies using gin (fields);
create index gin_roles_search       on roles using gin (search_tsv);
create index idx_roles_moderation   on roles (moderation_status, listing_status);
create index idx_roles_deadline     on roles (application_deadline);
```

> `search_tsv` is a generated column: `to_tsvector('english', coalesce(title,'')||' '||coalesce(description,''))`.

**user_profiles**

| column | type | notes |
|---|---|---|
| id | uuid pk references auth.users(id) on delete cascade | |
| display_name | text | |
| account_role | account_role not null default 'student' | RLS prevents self-elevation |
| created_at | timestamptz | |

A trigger on `auth.users` insert creates the profile row with `account_role='student'`.

**saved_opportunities**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk→auth.users | |
| role_id | uuid fk→roles | |
| created_at | timestamptz | |
| | | unique (user_id, role_id) |

**applications**

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk→auth.users | |
| role_id | uuid fk→roles | nullable (manual entries) |
| company_name | text | for manual entries |
| role_title | text | for manual entries |
| status | application_status not null default 'Applied' | |
| notes | text | |
| applied_at | date | |
| application_url | text | nullable |
| follow_up_date | date | nullable (upcoming/overdue follow-ups) |
| created_at / updated_at | timestamptz | |

Dedup constraints:

```sql
create unique index uq_app_role on applications (user_id, role_id) where role_id is not null;
create unique index uq_app_manual on applications (user_id, lower(company_name), lower(role_title)) where role_id is null;
```

**moderation_history**

| id | uuid pk | | 
|---|---|---|
| entity_type | text | 'company' \| 'role' |
| entity_id | uuid | |
| action | text | 'approved'\|'rejected'\|'edited' |
| actor_id | uuid fk→auth.users | |
| notes | text | |
| created_at | timestamptz | |

**listing_reports**

| id | uuid pk | |
|---|---|---|
| role_id | uuid fk→roles | |
| reason | text | 'expired'\|'broken'\|'incorrect'\|'other' |
| details | text | |
| reporter_id | uuid | nullable (anonymous allowed) |
| resolved | boolean default false | |
| created_at | timestamptz | |

### 2.3 Public eligibility view

Enforces Requirement 16 at the DB level. UI reads roles through this view for all public discovery.

```sql
create view public_roles as
select r.*
from roles r
join companies c on c.id = r.company_id
where r.moderation_status = 'Approved'
  and c.moderation_status = 'Approved'
  and r.listing_status = 'Active'
  and (r.application_deadline is null or r.application_deadline >= current_date);
```

The view is `security_invoker=on` so it respects the caller's RLS; a matching anon-readable policy exists on base tables for approved/active rows (below).

---

## 3. Row Level Security

RLS is enabled on every table. Policy summary:

**companies / roles / company_locations (public read of approved):**

> **Refinement #1 (closed-role banner):** The base-table `roles_public_read` policy intentionally does **not** filter on `listing_status`, so `getRole(slug)` can still load a recently closed/expired approved role and render the "Closed / no longer accepting applications" banner (Req 9.8). The strict `listing_status = 'Active'` and `application_deadline >= current_date` conditions are enforced in the `public_roles` **view**, which is the only path used by search, browse, featured, and company-profile role lists.

```sql
alter table roles enable row level security;
create policy roles_public_read on roles for select
  using (
    moderation_status = 'Approved'
    and exists (select 1 from companies c where c.id = company_id and c.moderation_status = 'Approved')
  );
-- community INSERT allowed but forced to Pending (enforced by trigger/check)
create policy roles_community_insert on roles for insert
  with check (moderation_status = 'Pending' and source = 'community');
-- admins full access
create policy roles_admin_all on roles for all
  using (public.is_admin()) with check (public.is_admin());
```

`public.is_admin()` is a `security definer` function returning whether `auth.uid()` has `account_role='admin'` in `user_profiles`.

**saved_opportunities / applications (owner-only):**

```sql
create policy saved_owner on saved_opportunities for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy app_owner on applications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

**user_profiles (no self-elevation):**

```sql
create policy profile_read on user_profiles for select using (id = auth.uid() or public.is_admin());
create policy profile_update on user_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and account_role = 'student');  -- cannot set self to admin
```

Admin elevation is done server-side (service role) or by the documented SQL snippet.

**listing_reports:** anyone (incl. anon) may insert; only admins may select/update.

**moderation_history:** only admins read; writes via service role / admin policy.

### 3.1 Admin bootstrap snippet (documented in README + migration comment)

```sql
-- Elevate the first admin after they sign up:
update public.user_profiles
set account_role = 'admin'
where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
```

---

## 4. Error Handling (cross-cutting)

- **Data layer:** every adapter method returns typed results; React Query surfaces `error`/`isError`. UI shows inline error + retry, never a blank screen.
- **ATS sync:** per-company try/catch; a failing company is logged and skipped (Req 17.6) without aborting the batch. Each run returns a summary `{ company, imported, updated, closed, errors }`.
- **External HTML:** DOMPurify sanitize; if sanitization yields empty, fall back to plain-text description.
- **Validation:** zod schemas shared between forms and adapter writes; failures map to field errors.
- **404/closed roles:** RoleDetail distinguishes "not found" (404 page) from "found but closed" (closed banner + similar roles, Req 9.8).

---

## 5. Live ATS Sync Engine

Shared core in `src/lib/ats/`, imported by CLI, dev middleware, and the production function.

### 5.1 Module layout

```
src/lib/ats/
  types.ts            NormalizedPosting, SyncResult, ProviderClient
  providers/
    greenhouse.ts     fetch + map → NormalizedPosting[]
    ashby.ts
    lever.ts
  classify.ts         isEarlyCareer(), excludeSenior()
  seasons.ts          extractSeasons(), cohortYear(), isConcluded()
  normalize.ts        provider payload → NormalizedPosting
  sync.ts             syncCompany(), syncAll(): fetch→filter→upsert→close-missing
  linkcheck.ts        headOrGet() throttled (community/reported only)
```

### 5.2 Provider adapters

Each provider implements `fetchPostings(token): Promise<RawPosting[]>` and `toNormalized(raw): NormalizedPosting`.

| Provider | Endpoint | Open-signal | Key fields mapped |
|---|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | endpoint returns only open jobs | `id`→external_job_id, `title`, `location.name`, `absolute_url`→apply_url, `content`→description(HTML, needs decode), `updated_at` |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` | require `isListed === true` | `id`, `title`, `location`, `workplaceType`→work_arrangement, `employmentType`, `applyUrl`, `descriptionHtml`, `compensation.*` |
| Lever | `GET api.lever.co/v0/postings/{token}?mode=json` | present in array = open | `id`, `text`→title, `categories.location`, `categories.commitment`→schedule, `workplaceType`, `hostedUrl`/`applyUrl`, `descriptionPlain`/`description`, `salaryRange` |

`NormalizedPosting` (common shape):

```ts
interface NormalizedPosting {
  externalJobId: string;
  title: string;
  descriptionHtml: string;      // raw; sanitized at render
  applyUrl: string;
  city?: string; state?: string; country?: string;
  workArrangement?: WorkArrangement;
  employmentTypeRaw?: string;
  pay?: { min?: number; max?: number; currency?: string; period?: string };
  updatedAt?: string;
}
```

### 5.3 Classification (`classify.ts`)

```ts
const EARLY = /\b(intern|internship|co-?op|fellow|apprentice|new ?grad|early career|university grad|campus|entry[ -]?level)\b/i;
const SENIOR = /\b(senior|staff|principal|director|manager|lead|sr\.?)\b/i;

export function isEarlyCareer(p: NormalizedPosting): boolean {
  if (SENIOR.test(p.title)) return false;                 // Req 18.2 exclusion wins
  if (p.employmentTypeRaw?.toLowerCase() === 'intern') return true;
  return EARLY.test(p.title) || EARLY.test(p.employmentTypeRaw ?? '');
}
```

Exclusion is checked first so "Senior Intern"-style titles are dropped.

### 5.4 Season + cohort logic (`seasons.ts`)

```ts
// Req 18.3-18.5
export function extractSeasons(text: string): Season[] {
  const t = text.toLowerCase();
  const hits: Season[] = [];
  if (/\b(fall|autumn)\b/.test(t)) hits.push('Fall');
  if (/\bwinter\b/.test(t))        hits.push('Winter');
  if (/\bspring\b/.test(t))        hits.push('Spring');
  if (/\bsummer\b/.test(t))        hits.push('Summer');
  return hits.length ? [...new Set(hits)] : ['Year-Round'];
}

// Locked cutoffs (end of cohort occurrence) — UTC for determinism (refinement #3)
const CUTOFF: Record<Exclude<Season,'Year-Round'>, (y:number)=>Date> = {
  Winter: y => new Date(Date.UTC(y, 2, 31, 23, 59, 59)),   // Mar 31
  Spring: y => new Date(Date.UTC(y, 4, 31, 23, 59, 59)),   // May 31
  Summer: y => new Date(Date.UTC(y, 7, 31, 23, 59, 59)),   // Aug 31
  Fall:   y => new Date(Date.UTC(y, 11, 15, 23, 59, 59)),  // Dec 15
};

// Req 19.1 + decision #4
export function isConcluded(season: Season, cohortYear: number | null, now = new Date()): boolean {
  if (season === 'Year-Round') return false;
  const year = cohortYear ?? nextOccurrenceYear(season, now); // no stated year ⇒ next upcoming
  if (cohortYear !== null && cohortYear < now.getFullYear()) return true; // past cohort year
  return now > CUTOFF[season](year);
}
```

`nextOccurrenceYear` picks this year if the cutoff is still ahead, else next year, so live postings without a year are not falsely rejected.

### 5.5 Sync algorithm (`sync.ts`)

```
syncCompany(company):
  raw = provider.fetchPostings(company.ats_board_token)
  normalized = raw.map(toNormalized).filter(providerOpenSignal)
  candidates = normalized
      .filter(isEarlyCareer)
      .map(attach seasons=extractSeasons(title+description), cohort=cohortYear(...))
      .filter(p => !isConcluded(primarySeason, cohort))   // Req 19.1
      .filter(p => isValidHttpUrl(p.applyUrl))             // Req 19.2
  liveIds = set(candidates.externalJobId)
  for p in candidates:
      upsert into roles on conflict (company_id, external_job_id)
        set listing_status='Active', last_verified_at=now(), source='ats', moderation_status='Approved'
  // close-missing (Req 19.4)
  update roles set listing_status='Closed'
     where company_id=company.id and source='ats'
       and external_job_id not in liveIds and listing_status='Active'
  return { company: company.name, imported, updated, closed, errors }
```

Seeded ATS roles are auto-`Approved` (trusted source); community roles stay `Pending`.

**Batch `syncAll()` (refinement #4):** iterate companies with `ats_provider != 'none'` using `Promise.allSettled` with **bounded concurrency of 5** and a per-request `AbortSignal.timeout(10000)`. A single slow or failing ATS endpoint is isolated (settled as `rejected`, logged into the run summary) and never stalls `/__sync` or `api/sync.ts`. A small concurrency pool (not an unbounded `Promise.all`) keeps us within provider rate limits.

### 5.6 Link health (`linkcheck.ts`)

Used only for community/reported roles (decision #3): throttled `HEAD` (fallback `GET`) with a short timeout; `404`/`410` ⇒ mark `Closed`. Never run against the whole ATS batch.

### 5.7 Geocoding (admin, decision #6)

`src/lib/geocode.ts` wraps Nominatim `search`:
- `User-Agent: Launchpad/1.0 (admin geocoder)`, 1 req/sec queue, result cached into `company_locations.latitude/longitude`.
- Invoked from `/admin` at approval time, never from public page loads (Req 11.4).

---

## 6. Frontend Architecture

### 6.1 Routing (`react-router-dom` v6)

| Path | Page | Notes |
|---|---|---|
| `/` | Home | search entry, live stats, featured |
| `/browse` | Browse | default Opportunities view; `?view=companies` |
| `/roles/:slug` | RoleDetail | shareable; closed banner handling |
| `/companies/:slug` | CompanyProfile | season-filterable roles |
| `/map` | MapPage | retains browse filters |
| `/resources` + `/resources/:slug` | Resources | 4 guides |
| `/applications` | MyApplications | saved + tracked |
| `/submit` | Submit | Form A + Form B |
| `/admin` | Admin | guarded by `RequireAdmin` |
| `*` | NotFound | |

### 6.2 State management

- **Server state:** React Query. Query keys encode filters so caching/invalidation are precise, e.g. `['roles', normalizedFilters]`.
- **URL = source of truth for discovery filters** via `useSearchParams`. A `useRoleFilters()` hook parses/serializes: `?q=&season=summer,fall&type=internship&remote=1&degree=undergraduate&field=technology&company=startup&sort=verified&view=opportunities`.
- **Local/anonymous state:** `localStorage` under `launchpad.saved` and `launchpad.applications`, wrapped by the same adapter interface as Supabase so UI never branches on auth.

### 6.3 Data adapter interface

```ts
interface DataAdapter {
  searchRoles(filters: RoleFilters): Promise<Paginated<RoleCard>>;
  getRole(slug: string): Promise<RoleDetail | null>;
  searchCompanies(filters: RoleFilters): Promise<Paginated<CompanyCard>>;
  getCompany(slug: string): Promise<CompanyDetail | null>;
  getStats(): Promise<{ companies: number; activeRoles: number; startups: number }>;
  getFeatured(): Promise<FeaturedBlocks>;
  listSaved(): Promise<SavedItem[]>;  save(roleId: string): Promise<void>;  unsave(roleId: string): Promise<void>;
  listApplications(): Promise<Application[]>;  upsertApplication(a: ApplicationInput): Promise<void>;
  submitCompany(input: CompanyFormA): Promise<void>;
  submitRole(input: RoleFormB): Promise<void>;
  reportListing(input: ReportInput): Promise<void>;
  // admin
  moderate(...): Promise<void>;  sync(companyId?: string): Promise<SyncResult[]>;  geocode(locationId: string): Promise<void>;
}
```

`SupabaseAdapter` and `LocalAdapter` both implement it. Migration on sign-in (`migrateLocalToAccount()`) reads `localStorage`, dedups per Req 12.6–12.8, writes via Supabase, then clears local keys.

### 6.4 Component hierarchy (key pieces)

```
App
 ├─ HelmetProvider / QueryClientProvider / AuthProvider / AdapterProvider
 ├─ Layout (Nav, Footer)
 └─ Routes
     ├─ Home → Hero(SearchBar, SeasonQuickSelect), HowItWorks, StatsBar, FeaturedGrid
     ├─ Browse
     │   ├─ FilterBar (SeasonPills, SortSelect, ViewToggle, ActiveFilterChips)
     │   ├─ FilterSidebar / FilterDrawer(mobile)   ← shared filter form
     │   ├─ ResultsHeader (count)
     │   └─ OpportunitiesView(RoleCard[]) | CompaniesView(CompanyCard[])
     ├─ RoleDetail → ClosedBanner?, ApplyButton, SaveButton, TrackButton, ReportButton, SimilarRoles
     ├─ CompanyProfile → CompanyHeader, SeasonFilter, RoleCard[]
     ├─ MapPage → Leaflet(MarkerCluster), CompanyPreviewCard (reuses browse filters)
     ├─ MyApplications → SavedList, ApplicationsBoard(status columns)
     ├─ Submit → CompanyForm(A), RoleForm(B) (zod + honeypot)
     └─ Admin → PendingQueue, SyncPanel, ReportsPanel, GeocodePanel
```

Shared primitives: `Badge` (season variants), `Button`, `Select`, `Checkbox`, `Dialog/Drawer` (Radix), `Card`, `EmptyState`, `Spinner`, `RelativeTime`. Styling via Tailwind with palette tokens in `tailwind.config`.

### 6.5 Filtering semantics

- Within a group (e.g. multiple seasons) → OR via Postgres array overlap `seasons && ARRAY[...]`.
- Across groups → AND.
- Remote-only → `work_arrangement = 'Remote'`.
- Keyword → `search_tsv @@ websearch_to_tsquery(q)` with relevance sort `ts_rank`.
- All discovery reads go through `public_roles` so eligibility (Req 16) is guaranteed server-side.

### 6.6 SEO & accessibility

- `react-helmet-async` sets per-page `<title>`, description, and OpenGraph tags on Home, Browse, RoleDetail, CompanyProfile.
- Semantic landmarks (`header/nav/main/footer`), labeled controls, focus-visible styles, keyboard-operable drawer/dialog (Radix), `aria-live` on result counts.

---

## 7. Seed Dataset

`src/data/seed-companies.ts` holds ≥30 verified companies (≥10 startups) across the six fields, each with real `ats_provider` + `ats_board_token`, HQ coords, `website_url`, `careers_url`. Seeding = insert companies (`moderation_status='Approved'`) → run `syncAll()` to populate real roles. Companies with zero open roles keep their profile and show `0 active roles` (Req 20.4). Token accuracy is validated during seed by a dry-run fetch; any token returning non-200 is flagged in the seed report for correction (no fabricated fallback).

---

## 8. Testing Strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | `classify`, `seasons` (extract + cutoffs incl. edge dates), `normalize` per provider, filter serializer, dedup/migration logic |
| Integration | Vitest + RTL + LocalAdapter | Browse combined filters (seasons incl. Year-Round, startup-only, remote-only, paid-only, degree), URL sync, closed-role banner, submission→pending, local tracking + migration dedup |
| Provider parsing | Vitest w/ recorded fixtures | Greenhouse/Ashby/Lever JSON → NormalizedPosting; `isListed` enforcement; season extraction; outdated-cohort rejection; dedup by external_job_id; auto-close removed roles |
| RLS | Vitest hitting local Postgres (or supabase test) | owner-only saved/apps, no self-elevation, public eligibility |
| E2E | Playwright | Home→Browse→filter→RoleDetail→Apply(new tab), save/track, submit flow, admin guard |
| Map | Vitest + RTL | marker only for geocoded locations; remote roles not mislocated |

Tests run against `LocalAdapter` with recorded ATS fixtures so no cloud creds or live network are required in CI (Req 23.3).

---

## 9. Project Structure (planned)

```
launchpad/
  .env.example
  index.html
  vite.config.ts        (+ dev-sync middleware)
  tailwind.config.ts
  package.json
  README.md
  server/
    dev-sync.ts
  api/
    sync.ts             (Vercel serverless; mirrors Edge fn)
  scripts/
    sync-ats-jobs.ts
    seed.ts
  supabase/
    migrations/         (schema, enums, view, RLS, triggers)
  src/
    main.tsx  App.tsx
    lib/
      adapter/ { types.ts, supabase.ts, local.ts, index.ts }
      ats/     { ...as section 5 }
      geocode.ts  supabaseClient.ts  sanitize.ts  filters.ts
    data/ seed-companies.ts
    hooks/ useRoleFilters.ts useAuth.ts useAdapter.ts
    components/ (primitives + feature components)
    pages/ (Home, Browse, RoleDetail, CompanyProfile, MapPage, Resources, MyApplications, Submit, Admin, NotFound)
    test/ fixtures/ (recorded ATS JSON)
```

---

## 10. Requirements Traceability (summary)

| Requirement | Primary design coverage |
|---|---|
| R1 public access | §6.1 routes, §6.3 local adapter, no auth gate |
| R2 Home | §6.4 Home, `getStats`/`getFeatured` |
| R3–R7 Browse/cards/filter/sort | §6.4–§6.5, `public_roles` |
| R8 startups | enums, filters, CompanyProfile |
| R9 role detail | §6.4 RoleDetail, §4 closed handling, DOMPurify |
| R10 company profile | §6.4 CompanyProfile |
| R11 map | §6.4 MapPage, §5.7 geocode, no invented coords |
| R12 saving/tracking/migration | §6.3 adapter + migrate + dedup indexes §2.2 |
| R13 resources | §6.1 routes |
| R14 submissions | §6.4 Submit, zod + honeypot, pending |
| R15 admin/sync | §6.4 Admin, §5 engine, §5.7 geocode |
| R16 eligibility | §2.3 view + §3 RLS |
| R17–R19 ATS/classify/expire | §5 entire |
| R20 seed | §7 |
| R21 auth/RLS | §3 |
| R22 schema | §2 |
| R23 local adapter | §1.3, §6.3, §8 |
| R24 SEO | §6.6 |
| R25 a11y | §6.6 |
| R26 visual | §6.4 primitives, tailwind palette |
| R27 security | §1.2, §4, sanitize.ts |
| R28 testing | §8 |
| R29 performance | §6.2 React Query, URL sync, no reload |
| R30 deploy/docs | §9, README, migrations, admin snippet §3.1 |

---

## 11. Deployment

- **Vercel:** SPA build + `api/sync.ts` serverless function; env vars for Supabase URL/anon key (client) and service role (server-only).
- **Supabase:** apply `supabase/migrations/` in order; run seed + initial `syncAll`; elevate admin via §3.1 snippet.
- **Cron:** Vercel Cron (or Supabase scheduled function) calls sync on a schedule to keep `last_verified_at` fresh and auto-close stale roles.
- **Secrets:** only anon key in client bundle; `service_role` confined to server runtime.
