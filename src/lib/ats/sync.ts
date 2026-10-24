import type { ProviderClient } from './types';
import type { EnrichedPosting } from './normalize';
import { selectCandidates } from './normalize';
import { createGreenhouseClient } from './providers/greenhouse';
import { createAshbyClient } from './providers/ashby';
import { createLeverClient } from './providers/lever';
import { createSmartRecruitersClientFor } from './providers/smartrecruiters';
import { createWorkableClient } from './providers/workable';
import { createWorkdayClient } from './providers/workday';
import type { AtsProvider, FieldType } from '../adapter/types';

export interface SyncableCompany {
  id: string;
  name: string;
  atsProvider: AtsProvider;
  atsBoardToken: string | null;
  /** Primary company field, used as a fallback when a role title is ambiguous. */
  fallbackField?: FieldType;
  /** Company HQ coordinates, used when a role is Remote or its city is unknown. */
  hqLatitude?: number | null;
  hqLongitude?: number | null;
  /** Company HQ city/state/country, used to fill a missing role display location. */
  hqCity?: string | null;
  hqState?: string | null;
  hqCountry?: string | null;
  /**
   * When true, only Internship / Co-op roles are ingested for this company
   * (Req 6 — Google/Amazon/Tesla/SpaceX are internship-only). Entry-level /
   * New-grad and full-time postings are dropped.
   */
  internshipOnly?: boolean;
}

export interface UpsertRoleData extends EnrichedPosting {
  companyId: string;
  /** Company field fallback for ambiguous titles. */
  companyFallbackField?: FieldType;
  /** Company HQ coords, used when the role is Remote or its city is unknown. */
  companyHqLatitude?: number | null;
  companyHqLongitude?: number | null;
  /** Company HQ display location, used to fill a missing role city/state. */
  companyHqCity?: string | null;
  companyHqState?: string | null;
  companyHqCountry?: string | null;
}

export interface SyncResult {
  company: string;
  companyId: string;
  imported: number;
  updated: number;
  closed: number;
  errors: string[];
  /** A partial feed may refresh found jobs without proving that absent jobs closed. */
  warnings?: string[];
}

/**
 * Persistence sink the sync engine writes through. Implemented by the Supabase
 * adapter (service role) and the local store. Keeps sync logic storage-agnostic.
 */
export interface SyncSink {
  /** Upsert by (companyId, externalJobId). Returns 'imported' | 'updated'. */
  upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'>;
  /** Optional bulk path for one company's postings, avoiding per-role database round trips. */
  upsertRoles?(data: UpsertRoleData[]): Promise<{ imported: number; updated: number }>;
  /** Mark all ats roles for a company whose externalJobId is not in liveIds as Closed. Returns count closed. */
  closeMissing(companyId: string, liveIds: string[]): Promise<number>;
}

export interface SyncOptions {
  now?: Date;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  /** Overall worker deadline, including persistence and close-missing work. */
  signal?: AbortSignal;
}

function clientFor(
  provider: AtsProvider,
  token: string,
  fetchImpl?: typeof fetch,
): ProviderClient | null {
  switch (provider) {
    case 'greenhouse':
      return createGreenhouseClient(fetchImpl) as ProviderClient;
    case 'ashby':
      return createAshbyClient(fetchImpl) as ProviderClient;
    case 'lever':
      return createLeverClient(fetchImpl) as ProviderClient;
    case 'smartrecruiters':
      // Token-bound so apply URLs resolve to jobs.smartrecruiters.com/{token}/{id}.
      return createSmartRecruitersClientFor(token, fetchImpl) as ProviderClient;
    case 'workable':
      return createWorkableClient(fetchImpl) as ProviderClient;
    case 'workday':
      return createWorkdayClient(fetchImpl) as ProviderClient;
    default:
      return null;
  }
}

/** Sync a single company: fetch → filter → upsert → close-missing. */
export async function syncCompany(
  company: SyncableCompany,
  sink: SyncSink,
  options: SyncOptions = {},
): Promise<SyncResult> {
  // 20s default: large Greenhouse boards (e.g. SpaceX's ~2,700 jobs) need more
  // than 10s to fetch + parse reliably under concurrency.
  const { now = new Date(), timeoutMs = 20_000, fetchImpl, signal } = options;
  const result: SyncResult = {
    company: company.name,
    companyId: company.id,
    imported: 0,
    updated: 0,
    closed: 0,
    errors: [],
  };

  const stopped = () => {
    if (!signal?.aborted) return false;
    result.errors.push('Sync stopped before completion: worker deadline or cancellation.');
    return true;
  };
  if (stopped()) return result;

  const client = clientFor(company.atsProvider, company.atsBoardToken ?? '', fetchImpl);
  if (!client || !company.atsBoardToken) {
    result.errors.push(`No ATS client/token for ${company.name}`);
    return result;
  }

  let candidates: EnrichedPosting[];
  let liveIds: string[];
  const fetchController = new AbortController();
  const abortFetch = () => fetchController.abort(signal?.reason);
  signal?.addEventListener('abort', abortFetch, { once: true });
  const fetchTimer = setTimeout(() => fetchController.abort(new Error('ATS fetch timed out')), timeoutMs);
  try {
    const raw = await client.fetchPostings(company.atsBoardToken, fetchController.signal);
    const normalized = raw
      .map((r) => client.toNormalized(r))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    // Presence in a feed is independent of whether our classification or write succeeds.
    liveIds = [...new Set(normalized.map((posting) => posting.externalJobId))];
    candidates = selectCandidates(normalized, now);
    // Req 6 — internship-only employers (Google/Amazon/Tesla/SpaceX): drop any
    // Entry-level / New-grad (or otherwise non-intern/co-op) candidates.
    if (company.internshipOnly) {
      candidates = candidates.filter(
        (c) => c.opportunityType === 'Internship' || c.opportunityType === 'Co-op',
      );
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result; // do not close-missing on a failed fetch (avoids wiping data)
  } finally {
    clearTimeout(fetchTimer);
    signal?.removeEventListener('abort', abortFetch);
  }

  if (stopped()) return result;
  const rows = candidates.map((posting): UpsertRoleData => ({
        ...posting,
        companyId: company.id,
        companyFallbackField: company.fallbackField,
        companyHqLatitude: company.hqLatitude ?? null,
        companyHqLongitude: company.hqLongitude ?? null,
        companyHqCity: company.hqCity ?? null,
        companyHqState: company.hqState ?? null,
        companyHqCountry: company.hqCountry ?? null,
      }));
  if (sink.upsertRoles) {
    for (let offset = 0; offset < rows.length; offset += 100) {
      if (stopped()) return result;
      try {
        const counts = await sink.upsertRoles(rows.slice(offset, offset + 100));
        result.imported += counts.imported;
        result.updated += counts.updated;
      } catch (err) {
        result.errors.push(`bulk upsert: ${err instanceof Error ? err.message : String(err)}`);
        // A retry can safely repeat earlier upserts. Never close jobs after a partial write.
        return result;
      }
    }
  } else {
    for (const row of rows) {
      if (stopped()) return result;
      try {
        const outcome = await sink.upsertRole(row);
        if (outcome === 'imported') result.imported++;
        else result.updated++;
      } catch (err) {
        result.errors.push(`upsert ${row.externalJobId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (stopped() || result.errors.length) return result;
  if (client.isCompleteSnapshot?.() === false) {
    result.warnings = ['This connector returns a partial or filtered feed; found jobs were refreshed, but absent jobs were not closed.'];
    return result;
  }
  try {
    result.closed = await sink.closeMissing(company.id, liveIds);
  } catch (err) {
    result.errors.push(`closeMissing: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/**
 * Run a bounded-concurrency pool over `items`, worker at a time up to `limit`.
 */
async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Sync every company with an ATS provider, using bounded concurrency so a
 * single slow/failing endpoint never stalls the whole batch (refinement #4).
 */
export async function syncAll(
  companies: SyncableCompany[],
  sink: SyncSink,
  options: SyncOptions = {},
): Promise<SyncResult[]> {
  const concurrency = options.concurrency ?? 7;
  const targets = companies.filter((c) => c.atsProvider !== 'none' && c.atsBoardToken);

  const settled = await pool(targets, concurrency, (company) =>
    syncCompany(company, sink, options),
  );

  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : {
          company: targets[i].name,
          companyId: targets[i].id,
          imported: 0,
          updated: 0,
          closed: 0,
          errors: [s.reason instanceof Error ? s.reason.message : String(s.reason)],
        },
  );
}
