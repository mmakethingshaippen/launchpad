# Structure — Launchpad

## Folder layout

```
launchpad/
  .env.example
  index.html
  vite.config.ts            # includes dev-sync middleware wiring
  tailwind.config.ts        # palette tokens, season badge variants
  package.json
  README.md
  server/
    dev-sync.ts             # local-only sync endpoint (Vite middleware)
  api/
    sync.ts                 # Vercel serverless sync (prod); mirrors Edge fn
  scripts/
    sync-ats-jobs.ts        # CLI sync (seeding + cron)
    seed.ts                 # insert seed companies, then syncAll
  supabase/
    migrations/             # enums, tables, indexes, public_roles view, RLS, triggers
  src/
    main.tsx
    App.tsx                 # providers + routes
    lib/
      adapter/              # types.ts, supabase.ts, local.ts, index.ts (selector)
      ats/                  # providers/, classify.ts, seasons.ts, normalize.ts, sync.ts, linkcheck.ts, types.ts
      geocode.ts
      supabaseClient.ts
      sanitize.ts
      filters.ts            # RoleFilters type + URL serialize/parse
    data/
      seed-companies.ts     # >=30 verified companies, >=10 startups
    hooks/
      useRoleFilters.ts  useAuth.ts  useAdapter.ts
    components/
      ui/                   # Badge, Button, Select, Checkbox, Dialog, Drawer, Card, EmptyState, Spinner, RelativeTime
      browse/               # FilterBar, FilterSidebar, FilterDrawer, SeasonPills, SortSelect, ViewToggle, ActiveFilterChips
      cards/                # RoleCard, CompanyCard
      ...feature components
    pages/
      Home.tsx  Browse.tsx  RoleDetail.tsx  CompanyProfile.tsx
      MapPage.tsx  Resources.tsx  MyApplications.tsx  Submit.tsx  Admin.tsx  NotFound.tsx
    test/
      fixtures/             # recorded Greenhouse/Ashby/Lever JSON
```

## Naming & conventions

- **Components:** PascalCase files and exports (`RoleCard.tsx`).
- **Hooks:** `useX` camelCase.
- **Non-component modules:** camelCase (`seasons.ts`, `filters.ts`).
- **Types/interfaces:** PascalCase; colocate shared domain types in `lib/adapter/types.ts` and `lib/ats/types.ts`.
- **DB:** snake_case tables/columns; Postgres enums for constrained values; `slug` columns for shareable URLs.

## Layering rules

- Pages compose feature components; feature components compose `ui/` primitives.
- Pages/components never call Supabase or fetch ATS directly — they go through the `DataAdapter` (via `useAdapter`) and React Query.
- ATS/sync/geocode logic lives in `lib/ats` and `lib/geocode` and is only invoked server-side (CLI, dev middleware, serverless/edge), never imported into browser render paths.
- URL is the source of truth for discovery filters; parse/serialize only in `useRoleFilters` + `lib/filters.ts`.

## Routes → pages

`/` Home · `/browse` Browse (`?view=companies` toggles) · `/roles/:slug` RoleDetail · `/companies/:slug` CompanyProfile · `/map` MapPage · `/resources` + `/resources/:slug` · `/applications` MyApplications · `/submit` Submit · `/admin` Admin (RequireAdmin guard) · `*` NotFound.

## Testing placement

Co-locate unit tests next to source as `*.test.ts(x)` or under `src/test/`. Provider-parsing tests use recorded fixtures in `src/test/fixtures/`. Playwright E2E specs live in `e2e/`. All tests must pass against `LocalAdapter` with no cloud credentials.
