# Launchpad — Requirements

## Document Status

- **Phase:** Step 1 of 4 (Requirements)
- **State:** Draft — awaiting review
- **Notation:** EARS (Easy Approach to Requirements Syntax)
  - `WHEN [trigger] THE SYSTEM SHALL [response]` — event-driven
  - `WHILE [state] THE SYSTEM SHALL [response]` — state-driven
  - `IF [condition] THEN THE SYSTEM SHALL [response]` — conditional/unwanted behavior
  - `WHERE [feature included] THE SYSTEM SHALL [response]` — optional feature
  - `THE SYSTEM SHALL [response]` — ubiquitous (always true)

## Introduction

Launchpad is a public web application that helps undergraduate students, graduate students, and recent graduates discover legitimate, currently open internships, co-ops, and early-career roles at both startups and established companies. The product's defining guarantees are **live verification** (every displayed role is confirmed open via employer ATS feeds and link checks) and **zero expired listings**. Browsing and applying never require an account; optional accounts add saving and application tracking. Community members can submit companies and roles for admin moderation.

This document defines the functional and non-functional acceptance criteria for the full product. Terminology is anchored to the data model in Section 6 of the product specification.

### Glossary

- **ATS** — Applicant Tracking System (Greenhouse, Lever, Ashby public JSON feeds).
- **Role** — an individual opportunity (internship, co-op, entry-level/new-grad).
- **Season/Term** — one of `Spring`, `Summer`, `Fall`, `Winter`, `Year-Round`.
- **Public eligibility rule** — the set of conditions a role must meet to appear in public search (defined in Requirement 16).
- **Anonymous user** — a visitor with no account; state persisted in `localStorage`.
- **Registered user** — a user authenticated via Supabase Auth.
- **Admin** — a registered user whose `account_role = 'admin'`.

---

## Requirement 1: Public Access Without Account

**User Story:** As a student, I want to browse and apply to opportunities without creating an account, so that I can find a job quickly with no friction.

#### Acceptance Criteria

1. THE SYSTEM SHALL allow access to the Home, Browse, Role Detail, Company Profile, Map, and Resources pages without authentication.
2. WHEN an anonymous user opens the application's live apply link THE SYSTEM SHALL open the employer's verified application destination in a new tab with `rel="noopener noreferrer"`.
3. IF a feature requires an account (saving to a synced account, tracking tied to a profile) THEN THE SYSTEM SHALL still offer an anonymous equivalent backed by `localStorage` rather than blocking the action.
4. THE SYSTEM SHALL NOT require authentication to view any publicly eligible role or approved company.

---

## Requirement 2: Home Page Discovery Entry

**User Story:** As a student, I want a clear landing page with search and term selection, so that I can start discovering opportunities immediately.

#### Acceptance Criteria

1. THE SYSTEM SHALL display Launchpad branding, a mission statement, a keyword search field, a Season/Term quick selector (`All Terms`, `Summer`, `Fall`, `Winter`, `Spring`), a location search field, a primary "Find Opportunities" action, and a secondary "Explore Startups" action.
2. WHEN a user submits the Home search THE SYSTEM SHALL navigate to Browse with the keyword, selected season/term, and location transferred as URL search parameters.
3. THE SYSTEM SHALL display a three-step "How It Works" section describing discover, apply, and track.
4. THE SYSTEM SHALL display statistics derived from live database queries: count of approved companies, count of active verified opportunities, and count of approved startups.
5. THE SYSTEM SHALL NOT display invented or hardcoded statistic values.
6. THE SYSTEM SHALL display featured sections (featured companies, startup opportunities, recently verified internships, opportunities by upcoming term, and opportunities approaching their deadline) selected only from approved, currently active records.
7. IF a featured section has no qualifying records THEN THE SYSTEM SHALL render a meaningful empty state rather than placeholder or fabricated content.

---

## Requirement 3: Browse — Opportunities and Companies Views

**User Story:** As a student, I want to browse individual opportunities by default and optionally switch to companies, so that I can discover roles efficiently.

#### Acceptance Criteria

1. WHEN a user opens Browse without a view parameter THE SYSTEM SHALL display the Opportunities view (individual role cards) by default.
2. THE SYSTEM SHALL provide a Companies view that displays company cards, and SHALL allow switching between Opportunities and Companies views.
3. THE SYSTEM SHALL apply the same keyword and filter state consistently across both views.
4. THE SYSTEM SHALL display prominent quick-filter pills for Term/Season (`Summer`, `Fall`, `Winter`, `Spring`, `Year-Round`) above the results, in addition to the sidebar filter panel.
5. THE SYSTEM SHALL display the count of matching active opportunities for the current filter state.
6. WHEN no results match the current filters THE SYSTEM SHALL display a meaningful empty state with a suggestion to clear or adjust filters.

---

## Requirement 4: Opportunity Card Content

**User Story:** As a student, I want each opportunity card to show the most relevant information, so that I can judge fit without opening every listing.

#### Acceptance Criteria

1. THE SYSTEM SHALL display on each opportunity card: position title, company name, company logo when legitimately available, season/term badge(s), industry/field, company type when known, location and work arrangement, degree eligibility, opportunity type, compensation status (and pay range when verified), application deadline when known, last-verified timestamp, a Save button, and View Details / Direct Apply actions.
2. WHERE a role's `last_verified_at` is known THE SYSTEM SHALL render a human-readable relative time (e.g., "Verified live 2h ago").
3. IF a field (company type, compensation, deadline, logo) is unknown THEN THE SYSTEM SHALL omit or mark it as not disclosed rather than inventing a value.
4. THE SYSTEM SHALL render season/term badges with visually distinct styling per season.

---

## Requirement 5: Company Card Content

**User Story:** As a student, I want company cards to summarize an organization and its open roles, so that I can explore employers.

#### Acceptance Criteria

1. THE SYSTEM SHALL display on each company card: company name, logo when available, industry/industries, company type, locations, documented undergraduate/graduate eligibility, a short description, the count of currently active opportunities, a careers page link, and an "Add a Role" submission action.
2. THE SYSTEM SHALL provide an expandable list of the company's available opportunities that respects the current search and season/term filters.
3. WHERE a company is a startup and startup metadata is verified THE SYSTEM SHALL additionally display stage, team size, and founding year.
4. IF a company has zero active opportunities THEN THE SYSTEM SHALL display "0 active roles" while still showing the profile and careers link.

---

## Requirement 6: Filtering

**User Story:** As a student, I want comprehensive, combinable filters, so that I can narrow results to exactly what I am eligible for and interested in.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide filters for: keyword (title, company, description, field), Season/Term (multi-select: `Spring`, `Summer`, `Fall`, `Winter`, `Year-Round`), opportunity type, location (city/state/country) with a remote-only toggle, degree level, field, work schedule, compensation, company type, startup stage, and company size.
2. WHEN multiple filters are selected simultaneously (including multiple seasons such as `Fall` + `Winter`) THE SYSTEM SHALL return only results matching all active filter groups, with multi-select values within a group treated as OR.
3. WHEN a filter changes THE SYSTEM SHALL update results without a full-page reload.
4. THE SYSTEM SHALL synchronize relevant search state (keyword, seasons, type, location, etc.) to the URL query string (e.g., `?season=summer,fall&type=internship`).
5. WHEN the application loads with search parameters in the URL THE SYSTEM SHALL restore the corresponding filter state.
6. THE SYSTEM SHALL display active filters as individually removable chips and provide a "Clear All Filters" action.
7. WHERE the viewport is mobile-sized THE SYSTEM SHALL present filters in a collapsible drawer.
8. THE SYSTEM SHALL keep "unknown" values (e.g., unknown startup stage) distinguishable from verified classifications and SHALL NOT infer funding stage from company size.

---

## Requirement 7: Sorting

**User Story:** As a student, I want to sort results, so that the freshest or most relevant roles surface first.

#### Acceptance Criteria

1. THE SYSTEM SHALL support sorting by: most recently verified (default), recently added, application deadline (soonest first), and company name.
2. WHEN a keyword search is active THE SYSTEM SHALL offer relevance-based sorting.
3. WHEN no sort is explicitly selected THE SYSTEM SHALL sort by most recently verified.
4. WHEN sorting by application deadline THE SYSTEM SHALL order roles with a known deadline ascending and place roles without a deadline consistently (last).

---

## Requirement 8: Startup Discovery

**User Story:** As a student interested in startups, I want to discover and filter startups specifically, so that early-stage opportunities get meaningful visibility.

#### Acceptance Criteria

1. THE SYSTEM SHALL allow filtering results exclusively to startups.
2. THE SYSTEM SHALL allow browsing startups by industry, stage, and size.
3. WHERE publicly verifiable startup data exists THE SYSTEM SHALL display name, website, industry, description, headquarters and office locations, remote-work availability, employee count/size range, funding stage, founding year, careers page, current opportunities, and the date company information was last verified.
4. WHEN a startup has no currently open roles THE SYSTEM SHALL still allow visiting its official careers page.
5. THE SYSTEM SHALL NOT fabricate startup stage, size, or founding year, and SHALL mark unknown values as such.

---

## Requirement 9: Role Detail Page

**User Story:** As a student, I want a dedicated, shareable page for each role, so that I can review full details and apply.

#### Acceptance Criteria

1. THE SYSTEM SHALL give every approved role a dedicated, shareable URL.
2. THE SYSTEM SHALL display job title, company name, company profile link, company type, field, season/term and cohort year when specified, location and work arrangement, accepted degree levels, opportunity type, work schedule, compensation details (amount, currency, pay period when known), duration, application deadline, formatted job description, original source, and last live-verification timestamp.
3. WHEN a role description is rendered from ATS HTML THE SYSTEM SHALL sanitize it with DOMPurify before rendering.
4. THE SYSTEM SHALL provide a primary "Apply on Company Website" action that opens the verified live destination in a new tab with `rel="noopener noreferrer"`.
5. THE SYSTEM SHALL provide secondary actions to Save the opportunity, Track an application (prefilled with known data), and Report an expired/incorrect listing.
6. WHEN a student submits a report of an expired or incorrect listing THE SYSTEM SHALL record the report and flag the role for re-verification.
7. IF a role's `listing_status` is `Closed`, `Expired`, or `Archived` THEN THE SYSTEM SHALL NOT display it in active search results.
8. WHEN a user visits the URL of a role that is no longer accepting applications THE SYSTEM SHALL display a clear "closed / no longer accepting applications" banner and link to active similar roles at that company or in that field.

---

## Requirement 10: Company Profile Page

**User Story:** As a student, I want a profile page per company, so that I can research an employer and see all its open roles.

#### Acceptance Criteria

1. THE SYSTEM SHALL display per approved company: name, logo, industry, company type, description, website, careers page, locations, accepted degree levels, verified startup stage/size when applicable, and all currently active opportunities.
2. THE SYSTEM SHALL allow filtering a company's listed opportunities by season/term.
3. THE SYSTEM SHALL provide each company a shareable URL.

---

## Requirement 11: Interactive Map

**User Story:** As a student, I want a map view of opportunities, so that I can discover roles by geography.

#### Acceptance Criteria

1. THE SYSTEM SHALL render an interactive map (React Leaflet + OpenStreetMap) with accurate markers, clustering, and zoom/pan.
2. WHEN a user clicks a marker THE SYSTEM SHALL show a clickable company preview card linking to the company profile and active roles.
3. THE SYSTEM SHALL retain active Browse filters (including season/term and startup filters) when the map view is used.
4. THE SYSTEM SHALL NOT invent map coordinates; only locations with resolved latitude/longitude are marked.
5. WHERE a role is fully remote THE SYSTEM SHALL keep it discoverable without assigning a misleading physical marker.

---

## Requirement 12: Saving and Application Tracking

**User Story:** As a student, I want to save roles and track my applications, whether or not I have an account, so that I can manage my search.

#### Acceptance Criteria

1. WHILE a user is anonymous THE SYSTEM SHALL persist saved opportunities and tracked applications in `localStorage`.
2. WHILE a user is registered THE SYSTEM SHALL persist saved opportunities and tracked applications in PostgreSQL via Supabase.
3. THE SYSTEM SHALL keep saved opportunities separate from submitted applications.
4. THE SYSTEM SHALL support application statuses `Applied`, `Interviewing`, `Offer`, and `Rejected`.
5. WHEN an anonymous user with local data signs in THE SYSTEM SHALL migrate local saved roles and applications into the account.
6. WHEN migrating saved roles THE SYSTEM SHALL deduplicate by `(user_id, role_id)`.
7. WHEN migrating applications THE SYSTEM SHALL deduplicate by `(user_id, role_id)` where `role_id` is present, and by `(user_id, lower(company_name), lower(role_title))` for manual custom entries.
8. THE SYSTEM SHALL NOT create duplicate saved or application records during migration or repeated sign-ins.

---

## Requirement 13: Resources

**User Story:** As a student, I want actionable career guides, so that I can improve my applications.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide four guides: Internship Resume Tips, Internship Interview Preparation, Finding Unlisted Internships (including startups and off-cycle Fall/Winter/Spring terms), and Evaluating an Internship Offer.
2. THE SYSTEM SHALL present each guide at a shareable URL with semantic, accessible content.

---

## Requirement 14: Community Submissions

**User Story:** As a community member, I want to submit companies and roles, so that opportunities I know about become discoverable after review.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide a Submit page with two clearly separated forms: Form A (Suggest a Company) and Form B (Post a Role).
2. THE SYSTEM SHALL validate both forms with zod and SHALL reject submissions that fail validation with field-level messages.
3. Form A THE SYSTEM SHALL capture name, website, industry, locations, company type, eligibility, description, careers URL, optional ATS provider (`greenhouse`/`lever`/`ashby`) and board token, and optional startup metadata with source URLs.
4. Form B THE SYSTEM SHALL capture company selection or new company info, job title, field, season/term (`Spring`/`Summer`/`Fall`/`Winter`/`Year-Round`), location, work arrangement, degree levels, opportunity type, work schedule, compensation status and pay range, duration, deadline, direct application URL, description, and source URL.
4. WHEN any community submission is received THE SYSTEM SHALL set its `moderation_status` to `Pending`.
5. THE SYSTEM SHALL include a honeypot anti-spam field and SHALL silently reject submissions where the honeypot is filled.
6. THE SYSTEM SHALL NOT display a pending submission in public search until it is approved.

---

## Requirement 15: Admin Moderation and Sync Control

**User Story:** As an admin, I want a protected dashboard to moderate submissions and control live sync, so that only legitimate, open roles reach students.

#### Acceptance Criteria

1. THE SYSTEM SHALL expose an admin interface at `/admin` protected by backend authorization and Supabase RLS.
2. IF a non-admin attempts to access `/admin` or admin operations THEN THE SYSTEM SHALL deny access.
3. THE SYSTEM SHALL allow admins to approve, reject, or edit pending companies and roles.
4. WHEN an admin resolves coordinates for a company location THE SYSTEM SHALL use the OpenStreetMap Nominatim API and store resolved latitude/longitude.
5. THE SYSTEM SHALL allow admins to review student-reported expired/broken links.
6. THE SYSTEM SHALL provide a "Sync Live Jobs" control for an individual company and for all companies in batch.
7. WHEN an admin triggers sync THE SYSTEM SHALL connect to the configured public ATS feeds, import new open early-career roles, extract season terms, verify application URLs are live, update `last_verified_at`, and mark roles removed from the feed as `Closed`.
8. WHEN an admin approves or rejects a record THE SYSTEM SHALL write a moderation history entry.

---

## Requirement 16: Public Eligibility Rule and Search Integrity

**User Story:** As a student, I want to trust that every result is real and currently open, so that I never waste time on dead listings.

#### Acceptance Criteria

1. THE SYSTEM SHALL include a role in public search results only when all of the following hold: `moderation_status = 'Approved'`, the parent company's `moderation_status = 'Approved'`, `listing_status = 'Active'`, and (`application_deadline IS NULL` OR `application_deadline >= CURRENT_DATE`).
2. THE SYSTEM SHALL enforce the public eligibility rule at the database level via Supabase RLS SELECT policies and/or a dedicated Postgres view.
3. THE SYSTEM SHALL NOT return expired, closed, archived, or unapproved roles from any public search or featured section.

---

## Requirement 17: Live ATS Sync Engine

**User Story:** As the platform, I want a modular sync engine that pulls real open roles, so that listings reflect live employer feeds.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide an ATS Sync Engine usable via a CLI script (`scripts/sync-ats-jobs.ts`), during initial seed setup, and from the admin dashboard.
2. WHEN syncing a Greenhouse company THE SYSTEM SHALL call `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` and extract `id`, `title`, `location.name`, `absolute_url`, `content`, and `updated_at`.
3. WHEN syncing an Ashby company THE SYSTEM SHALL call `GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true`, require `isListed === true`, and extract `id`, `title`, `location`, `workplaceType`, `employmentType`, `applyUrl`, `descriptionHtml`, and structured compensation when available.
4. WHEN syncing a Lever company THE SYSTEM SHALL call `GET https://api.lever.co/v0/postings/{token}?mode=json` and extract `id`, `text`, `categories.location`, `categories.commitment`, `workplaceType`, `hostedUrl`, `applyUrl`, `descriptionPlain`/`description`, and `salaryRange`.
5. WHEN importing a role THE SYSTEM SHALL deduplicate by `(company_id, external_job_id)` and update an existing record rather than inserting a duplicate.
6. IF an ATS feed request fails or returns malformed data THEN THE SYSTEM SHALL log the failure and continue syncing other companies without corrupting existing data.
7. THE SYSTEM SHALL NOT fabricate roles, salaries, or deadlines; all imported data originates from the live feed.

---

## Requirement 18: Early-Career Classification and Season Extraction

**User Story:** As a student, I want only genuine early-career roles with correct term tags, so that filtering by season is accurate.

#### Acceptance Criteria

1. WHEN classifying a synced posting THE SYSTEM SHALL treat it as early-career if `employmentType === 'Intern'` or the title/category matches (case-insensitive) `\b(intern|internship|co-op|coop|fellow|apprentice|new grad|early career|university grad|campus|entry level)\b`.
2. WHEN classifying a posting THE SYSTEM SHALL exclude it if the title matches senior/mid-level terms `senior`, `staff`, `principal`, `director`, `manager`, `lead`, `sr.` (case-insensitive).
3. WHEN extracting seasons THE SYSTEM SHALL tag `Fall` for fall/autumn, `Winter` for winter, `Spring` for spring, and `Summer` for summer keywords found in the title or body.
4. WHEN multiple seasonal terms appear (e.g., "Fall/Winter Co-op") THE SYSTEM SHALL include all matched terms in the `seasons` array.
5. IF no season is stated in the title or body THEN THE SYSTEM SHALL tag the role `['Year-Round']`.

---

## Requirement 19: Expiration, Freshness, and Link Health

**User Story:** As a student, I want stale and dead listings removed automatically, so that results stay trustworthy.

#### Acceptance Criteria

1. WHEN a posting references a past cohort year or a seasonal term that has already concluded relative to `CURRENT_DATE` THE SYSTEM SHALL reject it or mark it `Expired`, even if the employer left the post up.
2. WHEN importing a role THE SYSTEM SHALL verify `apply_url` is a valid HTTP/HTTPS URL.
3. WHERE link health checking is enabled THE SYSTEM SHALL perform a lightweight HEAD/GET check during sync and treat `404`/`410` responses as closed.
4. WHEN a sync runs for a company THE SYSTEM SHALL mark any existing role for that company with `source = 'ats'` whose `external_job_id` is absent from the live payload as `listing_status = 'Closed'`.
5. WHEN a sync completes THE SYSTEM SHALL update `last_verified_at` for roles confirmed present in the live feed.

---

## Requirement 20: Seed Dataset

**User Story:** As a stakeholder, I want a realistic initial dataset, so that the app is immediately useful and demonstrably live.

#### Acceptance Criteria

1. THE SYSTEM SHALL seed at least 30 real companies spanning Technology, Business, Healthcare, Engineering, Finance, and Marketing, including at least 10 startups.
2. THE SYSTEM SHALL configure verified `ats_provider`, `ats_board_token`, accurate HQ coordinates, official `website_url`, and `careers_url` for seeded companies.
3. WHEN the seed sync runs THE SYSTEM SHALL populate the database from live employer feeds only.
4. IF a seeded company has zero open roles today THEN THE SYSTEM SHALL retain the company profile and careers URL and display `0 active roles` without inventing a role.

---

## Requirement 21: Authentication and Authorization

**User Story:** As a user, I want secure optional accounts, so that my data is private and protected.

#### Acceptance Criteria

1. THE SYSTEM SHALL implement optional authentication via Supabase Auth.
2. THE SYSTEM SHALL enforce Row Level Security so a user can read and write only their own saved roles and applications.
3. IF a user attempts to read or modify another user's records THEN THE SYSTEM SHALL deny the operation.
4. THE SYSTEM SHALL prevent a user from elevating their own `account_role`.
5. THE SYSTEM SHALL NOT expose the Supabase `service_role` key in browser code.

---

## Requirement 22: Data Model Integrity

**User Story:** As a maintainer, I want a normalized, constraint-enforced schema, so that data stays consistent and queries stay fast.

#### Acceptance Criteria

1. THE SYSTEM SHALL implement the normalized schema for Company, Company Location, Role, User Profile, Saved Opportunity, Application, Moderation History, and Listing Reports with appropriate foreign keys.
2. THE SYSTEM SHALL enforce a unique constraint on `(company_id, external_job_id)` where `external_job_id IS NOT NULL`.
3. THE SYSTEM SHALL create GIN indexes on array columns (`fields`, `degree_levels`, `seasons`) and full-text search indexes on role titles and descriptions.
4. THE SYSTEM SHALL manage schema via version-controlled migrations in `supabase/migrations/`.
5. THE SYSTEM SHALL NOT use JSON files as the persistent production store for submissions or approved opportunities; JSON is permitted only for seed configuration, local fallback adapters, and static resources.

---

## Requirement 23: Local Fallback Adapter

**User Story:** As a developer, I want the app to run and test locally before cloud credentials exist, so that development is unblocked.

#### Acceptance Criteria

1. WHERE Supabase credentials are not configured THE SYSTEM SHALL run against a local data/seed adapter.
2. WHILE using the local adapter THE SYSTEM SHALL still fetch live public ATS JSON feeds directly.
3. THE SYSTEM SHALL pass its automated tests using the local adapter without live cloud credentials.

---

## Requirement 24: SEO and Metadata

**User Story:** As a student, I want public pages to be indexable and share well, so that I can find and share them.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide dynamic document titles and OpenGraph metadata for public company and role pages via `react-helmet-async`.
2. THE SYSTEM SHALL use semantic HTML and shareable, stable URLs for public pages.

---

## Requirement 25: Accessibility

**User Story:** As a student using assistive technology, I want accessible pages, so that I can use Launchpad fully.

#### Acceptance Criteria

1. THE SYSTEM SHALL support full keyboard navigation of interactive controls (search, filters, cards, actions).
2. THE SYSTEM SHALL provide accessible names/labels for form fields, buttons, and icon-only controls.
3. THE SYSTEM SHALL maintain color contrast consistent with the defined palette for text and interactive elements.
4. THE SYSTEM SHALL provide helpful loading and empty states.

> Note: Full WCAG conformance requires manual testing with assistive technologies and expert review; automated checks alone are insufficient.

---

## Requirement 26: Visual Design System

**User Story:** As a student, I want a clean, consistent, modern interface, so that the product feels trustworthy and easy to use.

#### Acceptance Criteria

1. THE SYSTEM SHALL use the defined palette: deep navy `#101B33`, bright cyan `#00C9D8`, white `#FFFFFF`, light gray background `#F5F7FA`.
2. THE SYSTEM SHALL render visually distinct season badges per term.
3. THE SYSTEM SHALL be responsive across mobile, tablet, and desktop breakpoints.

---

## Requirement 27: Security and HTML Sanitization

**User Story:** As a user, I want the app to be safe from injection and leakage, so that my session and data are protected.

#### Acceptance Criteria

1. THE SYSTEM SHALL sanitize all externally sourced ATS HTML with DOMPurify before rendering.
2. THE SYSTEM SHALL open all external links with `rel="noopener noreferrer"`.
3. THE SYSTEM SHALL keep secrets out of client bundles and rely on RLS for data authorization.

---

## Requirement 28: Testing and Acceptance

**User Story:** As a stakeholder, I want automated tests covering critical behavior, so that I can trust releases.

#### Acceptance Criteria

1. THE SYSTEM SHALL include tests for discovery and combined filters (seasons including Year-Round, startup-only, remote-only, paid-only, degree-level).
2. THE SYSTEM SHALL include tests for ATS sync and expiration (parsing Greenhouse/Ashby/Lever JSON, season extraction, outdated cohort rejection, dedup by `external_job_id`, auto-closing removed roles).
3. THE SYSTEM SHALL include tests for anonymous `localStorage` tracking, authenticated tracking, and deduplicated local-to-account migration.
4. THE SYSTEM SHALL include tests for community submission moderation and RLS protection.
5. THE SYSTEM SHALL include tests for interactive map marker accuracy.

---

## Requirement 29: Performance Targets

**User Story:** As a student, I want fast discovery, so that I can reach an application quickly.

#### Acceptance Criteria

1. THE SYSTEM SHALL support a user finding a relevant opportunity and reaching the employer's live application page in approximately 30 seconds under normal conditions.
2. WHEN filters change THE SYSTEM SHALL update results incrementally without a full-page reload.
3. THE SYSTEM SHALL cache server state with `@tanstack/react-query` to avoid redundant fetches.

---

## Requirement 30: Deployment and Documentation

**User Story:** As a maintainer, I want deployable, documented infrastructure, so that others can run and operate Launchpad.

#### Acceptance Criteria

1. THE SYSTEM SHALL provide `.env.example`, complete `supabase/migrations/`, a SQL snippet to elevate the initial admin user, and a comprehensive `README.md`.
2. THE SYSTEM SHALL be deployable to Vercel with Supabase as the backend.

---

## Open Questions and Recommendations

These are consequential items I recommend resolving before or during design. None block requirements approval.

1. **Stack is sufficient — one caveat (link health checks).** React + Vite is a client-side SPA. Live HTTP link verification and batch ATS sync must run server-side (browsers cannot reliably `HEAD` arbitrary cross-origin URLs due to CORS). Recommendation: run sync/link-checks in the CLI script and Supabase Edge Functions, never from the browser. I will specify this in `design.md`. **Approve this server-side boundary?**

2. **SEO for a client SPA.** True search-engine indexing/OpenGraph previews are weak with a pure client-rendered SPA. Options: (a) accept client-rendered `react-helmet-async` (simplest, meets the letter of the spec but weaker crawler support), or (b) add prerendering/SSR for public role/company pages (stronger SEO, more complexity). Recommendation: start with (a); revisit (b) if indexing matters at launch. **Which do you prefer?**

3. **Automated link health checks during sync.** A full HEAD/GET on every role on every sync is slow and can get rate-limited. Recommendation: rely on ATS feed presence as the primary open/closed signal (the spec notes Greenhouse only returns open jobs), and make per-URL HTTP checks optional/throttled. **Acceptable?**

4. **"Cohort year concluded" logic needs a concrete rule.** To mark a term as concluded we need date boundaries (e.g., Summer concludes ~Aug 31; Fall ~Dec 31). I will propose explicit season-end dates in `design.md`. **Any preferred boundaries?**

5. **Admin bootstrap.** The first admin will be elevated via a documented SQL snippet (update `account_role` directly in the DB). Confirmed as the intended approach per Section 14.

6. **Geocoding usage policy.** Nominatim has usage limits and requires a descriptive User-Agent. I will geocode on-demand at admin approval time (not per page load) and cache coordinates. **Acceptable?**

7. **Testing frameworks.** I propose Vitest + React Testing Library for unit/integration and Playwright for E2E. **Approve, or prefer alternatives?**
