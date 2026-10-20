/**
 * Live Supabase cleanup pass. Runs several idempotent passes:
 *
 *   1. Title gate — close any open role whose TITLE fails isEarlyCareerTitle
 *      (seniority / recruiter / generic full-time).
 *   2. Deadline + expired-term — close any open role whose application_deadline
 *      has passed, or whose title targets an expired past term/year (Req 7.3).
 *   3. Internship-only employers — close any open Google/Amazon/Tesla/SpaceX
 *      role that is not an Internship or Co-op (Req 6).
 *   4. opportunity_type correction — fix stored types that no longer match the
 *      strict classifier.
 *   5. Company classification — fix any company stuck as 'Other / Unknown' (or
 *      with no industry) to a proper inferred industry + size (Req 4).
 *
 * We set listing_status = 'Closed' (reversible) rather than hard-deleting, and
 * the public_roles view hides closed/expired roles immediately. Run:
 *   npm run cleanup            (apply)
 *   npm run cleanup -- --dry-run
 */
import { createServiceClient, isUsableCity } from '../src/lib/ats/supabaseSink';
import { isEarlyCareerTitle, matchEarlyCareerType } from '../src/lib/ats/classify';
import { isExpiredTerm } from '../src/lib/ats/seasons';
import { isRemoteLocation } from '../src/lib/ats/cityCoords';
import { INTERNSHIP_ONLY_SLUGS } from '../src/lib/ats/companyMatch';
import { resolveCompanyClassification } from '../src/lib/ats/classifyCompany';
import type { CompanyType, EmployeeRange, FieldType } from '../src/lib/adapter/types';

const PAGE = 1000;

interface RoleRow {
  id: string;
  title: string;
  opportunity_type: string;
  application_deadline: string | null;
  seasons: string[] | null;
  cohort_year: number | null;
  company_id: string;
  work_arrangement: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadActiveRoles(db: ReturnType<typeof createServiceClient>): Promise<RoleRow[]> {
  const out: RoleRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('roles')
      .select(
        'id,title,opportunity_type,application_deadline,seasons,cohort_year,company_id,work_arrangement,city,state,country',
      )
      .eq('listing_status', 'Active')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load roles: ${error.message}`);
    const batch = (data ?? []) as RoleRow[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

async function closeIds(
  db: ReturnType<typeof createServiceClient>,
  ids: string[],
  dryRun: boolean,
): Promise<number> {
  if (dryRun || ids.length === 0) return ids.length;
  let closed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const { error } = await db.from('roles').update({ listing_status: 'Closed' }).in('id', batch);
    if (error) throw new Error(`close batch: ${error.message}`);
    closed += batch.length;
  }
  return closed;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = createServiceClient();
  const today = todayUtc();

  // Map restricted-employer company_ids (Google/Amazon/Tesla/SpaceX).
  const { data: restrictedCompanies } = await db
    .from('companies')
    .select('id,slug')
    .in('slug', [...INTERNSHIP_ONLY_SLUGS]);
  const restrictedIds = new Set(
    ((restrictedCompanies ?? []) as Array<{ id: string }>).map((c) => c.id),
  );

  const roles = await loadActiveRoles(db);

  const failTitle: RoleRow[] = [];
  const failDeadline: RoleRow[] = [];
  const failTerm: RoleRow[] = [];
  const failInternshipOnly: RoleRow[] = [];
  for (const r of roles) {
    if (!isEarlyCareerTitle(r.title)) {
      failTitle.push(r);
      continue;
    }
    if (r.application_deadline && r.application_deadline.slice(0, 10) < today) {
      failDeadline.push(r);
      continue;
    }
    if (isExpiredTerm(r.title)) {
      failTerm.push(r);
      continue;
    }
    if (
      restrictedIds.has(r.company_id) &&
      r.opportunity_type !== 'Internship' &&
      r.opportunity_type !== 'Co-op'
    ) {
      failInternshipOnly.push(r);
    }
  }

  const allToClose = [...failTitle, ...failDeadline, ...failTerm, ...failInternshipOnly];
  // eslint-disable-next-line no-console
  console.log(
    `Active roles scanned: ${roles.length}\n` +
      `  fail title gate:          ${failTitle.length}\n` +
      `  past application deadline: ${failDeadline.length}\n` +
      `  expired season/term:       ${failTerm.length}\n` +
      `  non-intern @ Big4:         ${failInternshipOnly.length}\n` +
      `  → total to close:          ${allToClose.length}`,
  );
  const sample = [...failDeadline, ...failTerm, ...failInternshipOnly].slice(0, 15).map((r) => r.title);
  if (sample.length) {
    // eslint-disable-next-line no-console
    console.log('Sample (deadline/term/Big4):\n  - ' + sample.join('\n  - '));
  }

  const closed = await closeIds(db, allToClose.map((r) => r.id), dryRun);

  // opportunity_type correction on roles that remain open.
  const stillOpenIds = new Set(allToClose.map((r) => r.id));
  let fixedTypes = 0;
  if (!dryRun) {
    for (const r of roles) {
      if (stillOpenIds.has(r.id)) continue;
      const matched = matchEarlyCareerType(r.title);
      if (matched && matched !== r.opportunity_type) {
        const { error } = await db.from('roles').update({ opportunity_type: matched }).eq('id', r.id);
        if (!error) fixedTypes++;
      }
    }
  }

  // Req 2 — fix roles mislabeled Remote that actually have a real physical city.
  // (Earlier aggregator ingests defaulted a missing work_arrangement to Remote.)
  let fixedRemote = 0;
  for (const r of roles) {
    if (stillOpenIds.has(r.id)) continue;
    if (r.work_arrangement !== 'Remote') continue;
    const locationString = [r.city, r.state, r.country].filter(Boolean).join(', ');
    const genuinelyRemote = isRemoteLocation(locationString) || !isUsableCity(r.city);
    if (genuinelyRemote) continue; // keep Remote when there's no physical city
    if (!dryRun) {
      const { error } = await db.from('roles').update({ work_arrangement: 'Onsite' }).eq('id', r.id);
      if (!error) fixedRemote++;
    } else {
      fixedRemote++;
    }
  }

  // Company classification cleanup (Req 4): fix 'Other / Unknown' or field-less.
  let fixedCompanies = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('companies')
      .select('id,name,fields,company_type,employee_count_range')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load companies: ${error.message}`);
    const batch = (data ?? []) as Array<{
      id: string;
      name: string;
      fields: FieldType[] | null;
      company_type: CompanyType;
      employee_count_range: EmployeeRange | null;
    }>;
    for (const c of batch) {
      const needsFix =
        c.company_type === 'Other / Unknown' ||
        !(c.fields ?? []).some((f) => f && f !== 'Other') ||
        !c.employee_count_range;
      if (!needsFix) continue;
      const resolved = resolveCompanyClassification({
        name: c.name,
        fields: c.fields ?? [],
        companyType: c.company_type,
        employeeRange: c.employee_count_range,
      });
      if (!dryRun) {
        const { error: uErr } = await db
          .from('companies')
          .update({
            fields: resolved.fields,
            company_type: resolved.companyType,
            employee_count_range: resolved.employeeRange,
          })
          .eq('id', c.id);
        if (!uErr) fixedCompanies++;
      } else {
        fixedCompanies++;
      }
    }
    if (batch.length < PAGE) break;
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n${dryRun ? '[dry-run] would ' : ''}closed ${closed} roles; ` +
      `corrected opportunity_type on ${fixedTypes}; ` +
      `fixed mislabeled-Remote on ${fixedRemote}; ` +
      `reclassified ${fixedCompanies} companies.`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
