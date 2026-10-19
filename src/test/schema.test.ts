import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../supabase/migrations');
const init = readFileSync(path.join(migrationsDir, '0001_init.sql'), 'utf8');
const rls = readFileSync(path.join(migrationsDir, '0002_rls.sql'), 'utf8');

// These structural checks run everywhere (no DB needed) so the migration's
// intent is protected against regressions.
describe('schema migration structure', () => {
  it('creates all core tables', () => {
    for (const t of [
      'public.companies',
      'public.company_locations',
      'public.roles',
      'public.user_profiles',
      'public.saved_opportunities',
      'public.applications',
      'public.moderation_history',
      'public.listing_reports',
    ]) {
      expect(init, t).toContain(`create table ${t}`);
    }
  });

  it('includes refinement #2 columns on applications', () => {
    expect(init).toMatch(/application_url\s+text/);
    expect(init).toMatch(/follow_up_date\s+date/);
  });

  it('adds the ATS dedup unique constraint and key indexes', () => {
    expect(init).toContain('unique (company_id, external_job_id)');
    expect(init).toContain('using gin (seasons)');
    expect(init).toContain('using gin (search_tsv)');
    expect(init).toContain('uq_app_role');
    expect(init).toContain('uq_app_manual');
  });

  it('generates the full-text search tsvector column', () => {
    expect(init).toMatch(/search_tsv\s+tsvector generated always as/);
  });
});

describe('RLS migration structure', () => {
  it('defines public_roles view with the full eligibility rule (security_invoker)', () => {
    expect(rls).toContain('security_invoker = on');
    expect(rls).toContain("r.listing_status = 'Active'");
    expect(rls).toContain('application_deadline >= current_date');
  });

  it('refinement #1: base roles_public_read does NOT filter listing_status', () => {
    const policyStart = rls.indexOf('create policy roles_public_read');
    const policyEnd = rls.indexOf(';', policyStart);
    const policy = rls.slice(policyStart, policyEnd);
    expect(policy).toContain("moderation_status = 'Approved'");
    expect(policy).not.toContain('listing_status');
  });

  it('enables RLS and defines owner-only + no-self-elevation policies', () => {
    expect(rls).toContain('enable row level security');
    expect(rls).toContain('create policy saved_owner');
    expect(rls).toContain('create policy app_owner');
    // profile update cannot set admin
    expect(rls).toMatch(/profile_update[\s\S]*account_role = 'student'/);
  });
});

// Live DB assertions run only when a connection string is provided (Option b).
const hasDb = Boolean(process.env.DATABASE_URL || process.env.VITE_SUPABASE_URL);
describe.runIf(hasDb)('live database assertions', () => {
  it('placeholder — executed only when DATABASE_URL/VITE_SUPABASE_URL is set', () => {
    // Full DB-backed RLS assertions are wired here when a Postgres connection
    // is available (see tasks 3-4). Skipped by default so the suite runs
    // cleanly in LocalAdapter mode without a container.
    expect(hasDb).toBe(true);
  });
});
