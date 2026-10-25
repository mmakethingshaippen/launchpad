import type { SupabaseClient } from '@supabase/supabase-js';
import type { AggregatedPosting, AggregatorClient } from './types';
import { createTheMuseClient } from './themuse';
import { createRemotiveClient } from './remotive';
import { createAdzunaClient } from './adzuna';
import { createUsaJobsClient } from './usajobs';
import { createSimplifyClient } from '../simplify';
import { enrich, isDeadlinePassed } from '../normalize';
import { isEarlyCareer, classifyField } from '../classify';
import { resolveRoleCoords, isRemoteLocation } from '../cityCoords';
import { isValidHttpUrl, normalizeApplyUrl } from '../util';
import { roleConcluded, isExpiredTerm } from '../seasons';
import { isUsableCity } from '../supabaseSink';
import { canonicalCompanySlug, INTERNSHIP_ONLY_SLUGS } from '../companyMatch';
import { classifyCompanyByName } from '../classifyCompany';
import { createAmazonClient } from './amazon';

export interface AggregatorResult {
  source: string;
  companiesUpserted: number;
  rolesUpserted: number;
  errors: string[];
}

const BATCH_SIZE = 100;
const stamp = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function ingestAggregators(
  db: SupabaseClient,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<AggregatorResult[]> {
  const clients: AggregatorClient[] = [
    createSimplifyClient(opts.fetchImpl),
    createAmazonClient(opts.fetchImpl),
    createTheMuseClient(opts.fetchImpl),
    createRemotiveClient(opts.fetchImpl),
    createAdzunaClient(opts.fetchImpl),
    createUsaJobsClient(opts.fetchImpl),
  ];
  const now = opts.now ?? new Date();
  const results: AggregatorResult[] = [];
  const seenUrls = new Set<string>();

  // Validate credentials immediately instead of failing thousands of writes later.
  const { error: preflightError } = await db.from('roles').select('id').limit(1);
  if (preflightError) throw new Error(`Supabase preflight failed: ${preflightError.message}`);

  // Supabase returns at most 1000 rows by default; paginate to deduplicate ALL roles.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('roles').select('apply_url').range(offset, offset + 499);
    if (error) throw new Error(`Cannot load existing URLs: ${error.message}`);
    const rows = (data ?? []) as Array<{ apply_url: string | null }>;
    for (const role of rows) if (role.apply_url) seenUrls.add(normalizeApplyUrl(role.apply_url));
    if (rows.length < 500) break;
  }
  console.log(`[${stamp()}] Existing URLs loaded: ${seenUrls.size}`);

  // Share company IDs across feeds, avoiding repeated database lookups.
  const companyIds = new Map<string, string>();

  for (const client of clients) {
    const result: AggregatorResult = { source: client.source, companiesUpserted: 0, rolesUpserted: 0, errors: [] };
    console.log(`[${stamp()}] ${client.source}: fetching feed`);
    let postings: AggregatedPosting[];
    try {
      postings = await client.fetchEarlyCareer(AbortSignal.timeout(90_000));
    } catch (error) {
      result.errors.push(`Feed fetch: ${message(error)}`);
      console.error(`[${stamp()}] ${client.source}: ${message(error)}`);
      results.push(result);
      continue;
    }
    console.log(`[${stamp()}] ${client.source}: ${postings.length} postings fetched`);

    type RoleRow = {
      company_id: string; external_job_id: string; slug: string; title: string;
      field: string; opportunity_type: string; degree_levels: unknown; seasons: unknown;
      cohort_year: unknown; city: string | null; state: string | null; country: string | null;
      latitude: number | null; longitude: number | null; work_arrangement: string;
      application_deadline: string | null; apply_url: string; description: unknown;
      source: string; source_url: string; moderation_status: string;
      listing_status: string; last_verified_at: string;
    };
    let pending: RoleRow[] = [];

    async function flush() {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      let { error } = await db.from('roles').upsert(batch, { onConflict: 'company_id,external_job_id' });
      if (error && /latitude|longitude/.test(error.message) && /column/i.test(error.message)) {
        const withoutCoords = batch.map(({ latitude: _lat, longitude: _lon, ...row }) => row);
        ({ error } = await db.from('roles').upsert(withoutCoords, { onConflict: 'company_id,external_job_id' }));
      }
      if (!error) {
        result.rolesUpserted += batch.length;
      } else {
        // Isolate individual invalid records rather than dropping an entire batch.
        result.errors.push(`Batch write: ${error.message}`);
        for (const row of batch) {
          const { error: itemError } = await db.from('roles').upsert(row, { onConflict: 'company_id,external_job_id' });
          if (itemError) result.errors.push(`role ${row.external_job_id}: ${itemError.message}`);
          else result.rolesUpserted++;
        }
      }
      console.log(`[${stamp()}] ${client.source}: ${result.rolesUpserted} roles written; ${result.errors.length} errors`);
    }

    for (let index = 0; index < postings.length; index++) {
      const p = postings[index];
      try {
        if (!isValidHttpUrl(p.applyUrl)) continue;
        if (!isEarlyCareer({ title: p.title, employmentTypeRaw: p.employmentTypeRaw })) continue;
        const url = normalizeApplyUrl(p.applyUrl);
        if (seenUrls.has(url)) continue;
        const enriched = enrich(p);
        if (roleConcluded(enriched.seasons, enriched.cohortYear, now)) continue;
        if (isDeadlinePassed(p.deadline, now)) continue;
        if (isExpiredTerm(enriched.title, now)) continue;
        const slug = canonicalCompanySlug(p.companyName);
        if (INTERNSHIP_ONLY_SLUGS.has(slug) && enriched.opportunityType !== 'Internship' && enriched.opportunityType !== 'Co-op') continue;

        let companyId = companyIds.get(slug);
        if (!companyId) {
          const { data: existing, error } = await db.from('companies').select('id').eq('slug', slug).maybeSingle();
          if (error) throw new Error(`company lookup ${p.companyName}: ${error.message}`);
          if (existing) companyId = (existing as { id: string }).id;
          else {
            const brand = classifyCompanyByName(p.companyName);
            const { data: created, error: createError } = await db.from('companies').upsert({
              slug, name: p.companyName, website_url: p.companyWebsite ?? null,
              description: `Opportunities aggregated from ${client.source}.`,
              fields: brand?.fields ?? [classifyField(p.title)],
              company_type: brand?.companyType ?? 'Established Company',
              employee_count_range: brand?.employeeRange ?? '501+',
              degree_levels: [], ats_provider: 'none', source: 'aggregator',
              moderation_status: 'Approved', last_verified_at: now.toISOString(),
            }, { onConflict: 'slug' }).select('id').single();
            if (createError) throw new Error(`company ${p.companyName}: ${createError.message}`);
            companyId = (created as { id: string }).id;
            result.companiesUpserted++;
          }
          companyIds.set(slug, companyId);
        }

        const city = isUsableCity(p.city) ? p.city! : null;
        const state = city ? (p.state ?? null) : null;
        const country = city ? (p.country ?? null) : null;
        const location = [city, state, country].filter(Boolean).join(', ');
        const remote = p.workArrangement === 'Remote' || isRemoteLocation(location);
        const coords = remote ? null : resolveRoleCoords(location || city || null);
        const row: RoleRow = {
          company_id: companyId, external_job_id: enriched.externalJobId,
          slug: `${slug}-${enriched.externalJobId}`.slice(0, 80),
          title: enriched.title,
          field: enriched.field !== 'Other' ? enriched.field : classifyField(enriched.title),
          opportunity_type: enriched.opportunityType, degree_levels: enriched.degreeLevels,
          seasons: enriched.seasons, cohort_year: enriched.cohortYear,
          city, state, country, latitude: coords?.latitude ?? null,
          longitude: coords?.longitude ?? null,
          work_arrangement: p.workArrangement ?? (remote ? 'Remote' : 'Onsite'),
          application_deadline: p.deadline ? p.deadline.slice(0, 10) : null,
          apply_url: p.applyUrl, description: enriched.descriptionHtml,
          source: 'aggregator', source_url: p.applyUrl,
          moderation_status: 'Approved', listing_status: 'Active',
          last_verified_at: now.toISOString(),
        };
        pending.push(row);
        seenUrls.add(url);
        if (pending.length >= BATCH_SIZE) await flush();
      } catch (error) {
        result.errors.push(message(error));
      }
      if ((index + 1) % 500 === 0) {
        console.log(`[${stamp()}] ${client.source}: scanned ${index + 1}/${postings.length}; inserted ${result.rolesUpserted}`);
      }
    }
    await flush();
    console.log(`[${stamp()}] ${client.source}: complete; ${result.rolesUpserted} written, ${result.errors.length} errors`);
    results.push(result);
  }
  return results;
}
