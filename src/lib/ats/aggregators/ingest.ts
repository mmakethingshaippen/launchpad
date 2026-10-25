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
  /** Newly inserted roles. Kept under this name for existing callers. */
  rolesUpserted: number;
  fetched: number;
  processed: number;
  /** Existing aggregator roles whose URL or stable id was observed in this feed. */
  refreshed: number;
  duplicatesSkipped: number;
  skippedInvalid: number;
  skippedExpired: number;
  errors: string[];
  durationMs: number;
}

const WRITE_BATCH = 100;
const READ_PAGE = 1000;
const stamp = () => new Date().toISOString();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

type RoleRow = {
  company_id: string;
  external_job_id: string;
  slug: string;
  title: string;
  field: string;
  opportunity_type: string;
  degree_levels: unknown;
  seasons: unknown;
  cohort_year: unknown;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  work_arrangement: string;
  application_deadline: string | null;
  apply_url: string;
  description: unknown;
  source: string;
  source_url: string;
  moderation_status: string;
  listing_status: string;
  last_verified_at: string;
};

type IndexedRole = {
  id: string;
  company_id: string;
  external_job_id: string | null;
  apply_url: string | null;
  source: string | null;
  listing_status: string | null;
};

/**
 * A run is successful only when every source finished without a recorded error.
 * Inserts can still have happened; callers must not treat that as a clean run.
 */
export function aggregatorRunSucceeded(results: AggregatorResult[]): boolean {
  return results.every((result) => result.errors.length === 0);
}

function isMissingCoordColumn(error: { message: string } | null): boolean {
  return Boolean(error && /latitude|longitude/.test(error.message) && /column/i.test(error.message));
}

export async function ingestAggregators(
  db: SupabaseClient,
  opts: { fetchImpl?: typeof fetch; now?: Date; clients?: AggregatorClient[] } = {},
): Promise<AggregatorResult[]> {
  const startedAt = Date.now();
  const clients: AggregatorClient[] = opts.clients ?? [
    createSimplifyClient(opts.fetchImpl),
    createAmazonClient(opts.fetchImpl),
    createTheMuseClient(opts.fetchImpl),
    createRemotiveClient(opts.fetchImpl),
    createAdzunaClient(opts.fetchImpl),
    createUsaJobsClient(opts.fetchImpl),
  ];
  const now = opts.now ?? new Date();
  const verifiedAt = now.toISOString();
  const results: AggregatorResult[] = [];

  // Validate credentials before downloading feeds or writing rows.
  const { error: preflightError } = await db.from('roles').select('id').limit(1);
  if (preflightError) throw new Error(`Supabase preflight failed: ${preflightError.message}`);

  const companyIds = await loadCompanyIds(db);
  console.log(`[${stamp()}] Companies cached: ${companyIds.size}`);

  const index = await loadRoleIndex(db);
  console.log(
    `[${stamp()}] Existing roles indexed: ${index.seenUrls.size} urls, ` +
    `${index.seenExternal.size} stable ids, ${index.refreshable.size} active aggregator roles eligible to refresh`,
  );

  for (const client of clients) {
    const sourceStarted = Date.now();
    const result: AggregatorResult = {
      source: client.source,
      companiesUpserted: 0,
      rolesUpserted: 0,
      fetched: 0,
      processed: 0,
      refreshed: 0,
      duplicatesSkipped: 0,
      skippedInvalid: 0,
      skippedExpired: 0,
      errors: [],
      durationMs: 0,
    };
    console.log(`[${stamp()}] ${client.source}: fetching feed`);
    let postings: AggregatedPosting[];
    try {
      postings = await client.fetchEarlyCareer(AbortSignal.timeout(90_000));
    } catch (error) {
      result.errors.push(`Feed fetch: ${message(error)}`);
      result.durationMs = Date.now() - sourceStarted;
      console.error(`[${stamp()}] ${client.source}: ${message(error)}`);
      results.push(result);
      continue;
    }
    result.fetched = postings.length;
    console.log(`[${stamp()}] ${client.source}: ${postings.length} postings fetched`);

    let pending: RoleRow[] = [];
    let pendingRefresh: string[] = [];

    async function writeRows(batch: RoleRow[]): Promise<string | null> {
      let { error } = await db.from('roles').upsert(batch, { onConflict: 'company_id,external_job_id' });
      if (isMissingCoordColumn(error)) {
        const withoutCoords = batch.map(({ latitude: _lat, longitude: _lon, ...row }) => row);
        ({ error } = await db.from('roles').upsert(withoutCoords, { onConflict: 'company_id,external_job_id' }));
      }
      return error ? error.message : null;
    }

    async function flushWrites() {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      const error = await writeRows(batch);
      if (!error) {
        result.rolesUpserted += batch.length;
      } else {
        // A bad row should not drop the rest of the batch. Inserts are idempotent.
        result.errors.push(`Batch write: ${error}`);
        for (const row of batch) {
          const itemError = await writeRows([row]);
          if (itemError) result.errors.push(`role ${row.external_job_id}: ${itemError}`);
          else result.rolesUpserted++;
        }
      }
      console.log(
        `[${stamp()}] ${client.source}: ${result.rolesUpserted} new roles written; ` +
        `${result.errors.length} errors`,
      );
    }

    async function flushRefresh() {
      if (!pendingRefresh.length) return;
      const ids = pendingRefresh;
      pendingRefresh = [];
      for (let offset = 0; offset < ids.length; offset += WRITE_BATCH) {
        const batch = ids.slice(offset, offset + WRITE_BATCH);
        // Stamp only rows we loaded as active aggregator listings. Do not reopen
        // closed rows and do not touch ATS rows that share an application URL.
        const { error } = await db.from('roles').update({ last_verified_at: verifiedAt })
          .eq('source', 'aggregator')
          .eq('listing_status', 'Active')
          .in('id', batch);
        if (error) {
          result.errors.push(`Verify batch (${batch.length}): ${error.message}`);
          console.error(`[${stamp()}] ${client.source}: verify batch failed: ${error.message}`);
        } else {
          result.refreshed += batch.length;
        }
      }
      console.log(`[${stamp()}] ${client.source}: ${result.refreshed} existing roles refreshed`);
    }

    for (let indexPos = 0; indexPos < postings.length; indexPos++) {
      const posting = postings[indexPos];
      result.processed++;
      try {
        if (!isValidHttpUrl(posting.applyUrl) || !posting.companyName?.trim()) {
          result.skippedInvalid++;
          continue;
        }
        if (!isEarlyCareer({ title: posting.title, employmentTypeRaw: posting.employmentTypeRaw })) {
          result.skippedInvalid++;
          continue;
        }
        const enriched = enrich(posting);
        if (
          roleConcluded(enriched.seasons, enriched.cohortYear, now) ||
          isDeadlinePassed(posting.deadline, now) ||
          isExpiredTerm(enriched.title, now)
        ) {
          // Seen, but not evidence the job is currently open. Leave any existing
          // verification timestamp unchanged and do not close from absence.
          result.skippedExpired++;
          continue;
        }
        const slug = canonicalCompanySlug(posting.companyName);
        if (
          INTERNSHIP_ONLY_SLUGS.has(slug) &&
          enriched.opportunityType !== 'Internship' &&
          enriched.opportunityType !== 'Co-op'
        ) {
          result.skippedInvalid++;
          continue;
        }

        const companyId = await resolveCompanyId(db, companyIds, slug, posting, client.source, now, result);
        const url = normalizeApplyUrl(posting.applyUrl);
        const externalKey = `${companyId}\0${enriched.externalJobId}`;
        const observation = index.observe(url, externalKey);
        if (observation === 'refresh') {
          index.rememberNew(url, externalKey);
          pendingRefresh.push(...index.takePendingRefresh());
          if (pendingRefresh.length >= WRITE_BATCH) await flushRefresh();
        } else if (observation === 'duplicate') {
          index.rememberNew(url, externalKey);
          result.duplicatesSkipped++;
        } else {
          const city = isUsableCity(posting.city) ? posting.city! : null;
          const state = city ? (posting.state ?? null) : null;
          const country = city ? (posting.country ?? null) : null;
          const location = [city, state, country].filter(Boolean).join(', ');
          const remote = posting.workArrangement === 'Remote' || isRemoteLocation(location);
          const coords = remote ? null : resolveRoleCoords(location || city || null);
          pending.push({
            company_id: companyId,
            external_job_id: enriched.externalJobId,
            slug: `${slug}-${enriched.externalJobId}`.slice(0, 80),
            title: enriched.title,
            field: enriched.field !== 'Other' ? enriched.field : classifyField(enriched.title),
            opportunity_type: enriched.opportunityType,
            degree_levels: enriched.degreeLevels,
            seasons: enriched.seasons,
            cohort_year: enriched.cohortYear,
            city,
            state,
            country,
            latitude: coords?.latitude ?? null,
            longitude: coords?.longitude ?? null,
            work_arrangement: posting.workArrangement ?? (remote ? 'Remote' : 'Onsite'),
            application_deadline: posting.deadline ? posting.deadline.slice(0, 10) : null,
            apply_url: posting.applyUrl,
            description: enriched.descriptionHtml,
            source: 'aggregator',
            source_url: posting.applyUrl,
            moderation_status: 'Approved',
            listing_status: 'Active',
            last_verified_at: verifiedAt,
          });
          index.rememberNew(url, externalKey);
          if (pending.length >= WRITE_BATCH) await flushWrites();
        }
      } catch (error) {
        result.errors.push(message(error));
      }
      if ((indexPos + 1) % 500 === 0) {
        await flushWrites();
        await flushRefresh();
        console.log(
          `[${stamp()}] ${client.source}: scanned ${indexPos + 1}/${postings.length}; ` +
          `new ${result.rolesUpserted}; refreshed ${result.refreshed}; ` +
          `duplicates ${result.duplicatesSkipped}; invalid ${result.skippedInvalid}; ` +
          `expired ${result.skippedExpired}; errors ${result.errors.length}`,
        );
      }
    }
    await flushWrites();
    await flushRefresh();
    result.durationMs = Date.now() - sourceStarted;
    console.log(
      `[${stamp()}] ${client.source}: complete in ${(result.durationMs / 1000).toFixed(1)}s; ` +
      `fetched ${result.fetched}; new ${result.rolesUpserted}; refreshed ${result.refreshed}; ` +
      `duplicates ${result.duplicatesSkipped}; invalid ${result.skippedInvalid}; ` +
      `expired ${result.skippedExpired}; companies ${result.companiesUpserted}; errors ${result.errors.length}`,
    );
    results.push(result);
  }

  const withErrors = results.reduce((sum, result) => sum + result.errors.length, 0);
  console.log(
    `[${stamp()}] Aggregator pass finished in ${((Date.now() - startedAt) / 1000).toFixed(1)}s; ` +
    `${results.length} sources; errors ${withErrors}. ` +
    'Unobserved jobs were not closed or re-stamped.',
  );
  return results;
}

async function loadCompanyIds(db: SupabaseClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const rows = await loadPages<{ id: string; slug: string | null }>(
    db,
    'companies',
    'id,slug',
    'Cannot load companies',
  );
  for (const row of rows) {
    if (row.slug && !ids.has(row.slug)) ids.set(row.slug, row.id);
  }
  return ids;
}

class RoleIndex {
  readonly seenUrls = new Set<string>();
  readonly seenExternal = new Set<string>();
  private readonly urlToIds = new Map<string, string[]>();
  private readonly externalToIds = new Map<string, string[]>();
  readonly refreshable = new Set<string>();
  private readonly queuedRefresh = new Set<string>();
  private pendingRefresh: string[] = [];

  add(role: IndexedRole) {
    if (role.apply_url) {
      const url = normalizeApplyUrl(role.apply_url);
      if (url) {
        this.seenUrls.add(url);
        const list = this.urlToIds.get(url) ?? [];
        list.push(role.id);
        this.urlToIds.set(url, list);
      }
    }
    if (role.external_job_id) {
      const key = `${role.company_id}\0${role.external_job_id}`;
      this.seenExternal.add(key);
      const list = this.externalToIds.get(key) ?? [];
      list.push(role.id);
      this.externalToIds.set(key, list);
    }
    if (role.source === 'aggregator' && role.listing_status === 'Active') {
      this.refreshable.add(role.id);
    }
  }

  observe(url: string, externalKey: string): 'new' | 'refresh' | 'duplicate' {
    const ids = new Set<string>([
      ...(this.urlToIds.get(url) ?? []),
      ...(this.externalToIds.get(externalKey) ?? []),
    ]);
    const known = ids.size > 0 || this.seenUrls.has(url) || this.seenExternal.has(externalKey);
    if (!known) return 'new';
    let queued = false;
    for (const id of ids) {
      if (this.refreshable.has(id) && !this.queuedRefresh.has(id)) {
        this.queuedRefresh.add(id);
        this.pendingRefresh.push(id);
        queued = true;
      }
    }
    return queued ? 'refresh' : 'duplicate';
  }

  takePendingRefresh(): string[] {
    const ids = this.pendingRefresh;
    this.pendingRefresh = [];
    return ids;
  }

  rememberNew(url: string, externalKey: string) {
    if (url) this.seenUrls.add(url);
    if (externalKey) this.seenExternal.add(externalKey);
  }
}

async function loadRoleIndex(db: SupabaseClient): Promise<RoleIndex> {
  const index = new RoleIndex();
  const rows = await loadPages<IndexedRole>(
    db,
    'roles',
    'id,company_id,external_job_id,apply_url,source,listing_status',
    'Cannot load existing roles',
  );
  for (const role of rows) index.add(role);
  return index;
}

async function loadPages<T extends { id: string }>(
  db: SupabaseClient,
  table: 'roles' | 'companies',
  columns: string,
  failure: string,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = db.from(table).select(columns).order('id', { ascending: true }).limit(READ_PAGE);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error(`${failure}: ${error.message}`);
    const page = (data ?? []) as unknown as T[];
    if (!page.length) break;
    const next = page[page.length - 1]?.id;
    if (!next || next === cursor) throw new Error(`${table} pagination made no progress.`);
    rows.push(...page);
    cursor = next;
    // Keep going when a project caps pages below READ_PAGE. An empty page ends the scan.
  }
  return rows;
}

async function resolveCompanyId(
  db: SupabaseClient,
  companyIds: Map<string, string>,
  slug: string,
  posting: AggregatedPosting,
  source: string,
  now: Date,
  result: AggregatorResult,
): Promise<string> {
  const cached = companyIds.get(slug);
  if (cached) return cached;

  const brand = classifyCompanyByName(posting.companyName);
  const { data: created, error: createError } = await db.from('companies').upsert({
    slug,
    name: posting.companyName,
    website_url: posting.companyWebsite ?? null,
    description: `Opportunities aggregated from ${source}.`,
    fields: brand?.fields ?? [classifyField(posting.title)],
    company_type: brand?.companyType ?? 'Established Company',
    employee_count_range: brand?.employeeRange ?? '501+',
    degree_levels: [],
    ats_provider: 'none',
    source: 'aggregator',
    moderation_status: 'Approved',
    last_verified_at: now.toISOString(),
  }, { onConflict: 'slug' }).select('id').single();
  if (createError) throw new Error(`company ${posting.companyName}: ${createError.message}`);
  const companyId = (created as { id: string }).id;
  companyIds.set(slug, companyId);
  result.companiesUpserted++;
  return companyId;
}