/**
 * One-off cleanup: close every currently-open role whose TITLE fails the strict
 * early-career gate (isEarlyCareerTitle). This purges the Vice President /
 * Director / Senior / Executive / Manager roles and the full-time Early-Career /
 * University recruiter roles that leaked in before the filter was tightened.
 *
 * We set listing_status = 'Closed' rather than hard-deleting so the action is
 * reversible and the public_roles view (which requires Active) hides them
 * immediately. Run with: npm run cleanup
 */
import { createServiceClient } from '../src/lib/ats/supabaseSink';
import { isEarlyCareerTitle, matchEarlyCareerType } from '../src/lib/ats/classify';

const PAGE = 1000;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = createServiceClient();

  // Pull all currently-open roles (paginated).
  const offenders: Array<{ id: string; title: string; opportunity_type: string }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from('roles')
      .select('id,title,opportunity_type')
      .eq('listing_status', 'Active')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load roles: ${error.message}`);
    const batch = data ?? [];
    for (const r of batch as Array<{ id: string; title: string; opportunity_type: string }>) {
      if (!isEarlyCareerTitle(r.title)) offenders.push(r);
    }
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  // eslint-disable-next-line no-console
  console.log(`Scanned open roles; ${offenders.length} fail the strict title gate.`);
  const sample = offenders.slice(0, 25).map((o) => o.title);
  // eslint-disable-next-line no-console
  console.log('Sample of titles to be closed:\n  - ' + sample.join('\n  - '));

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('\n--dry-run: no changes written.');
    return;
  }

  // Close offenders in id batches of 200.
  let closed = 0;
  for (let i = 0; i < offenders.length; i += 200) {
    const ids = offenders.slice(i, i + 200).map((o) => o.id);
    const { error } = await db
      .from('roles')
      .update({ listing_status: 'Closed' })
      .in('id', ids);
    if (error) throw new Error(`close batch: ${error.message}`);
    closed += ids.length;
  }
  // eslint-disable-next-line no-console
  console.log(`Closed ${closed} non-early-career / recruiter roles.`);

  // Correct opportunity_type on the remaining open roles whose stored type no
  // longer matches the strict classifier (e.g. new-grad mislabeled Internship).
  let fixed = 0;
  from = 0;
  for (;;) {
    const { data, error } = await db
      .from('roles')
      .select('id,title,opportunity_type')
      .eq('listing_status', 'Active')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`reload roles: ${error.message}`);
    const batch = (data ?? []) as Array<{ id: string; title: string; opportunity_type: string }>;
    for (const r of batch) {
      const matched = matchEarlyCareerType(r.title);
      if (matched && matched !== r.opportunity_type) {
        const { error: uErr } = await db
          .from('roles')
          .update({ opportunity_type: matched })
          .eq('id', r.id);
        if (!uErr) fixed++;
      }
    }
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  // eslint-disable-next-line no-console
  console.log(`Corrected opportunity_type on ${fixed} roles.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
