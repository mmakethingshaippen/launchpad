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
}

/**
 * Persistence sink the sync engine writes through. Implemented by the Supabase
 * adapter (service role) and the local store. Keeps sync logic storage-agnostic.
 */
export interface SyncSink {
  /** Upsert by (companyId, externalJobId). Returns 'imported' | 'updated'. */
  upsertRole(data: UpsertRoleData): Promise<'imported' | 'updated'>;
  /** Mark all ats roles for a company whose externalJobId is not in liveIds as Closed. Returns count closed. */
  closeMissing(companyId: string, liveIds: string[]): Promise<number>;
}

export interface SyncOptions {
  now?: Date;
  timeoutMs?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
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
  const { now = new Date(), timeoutMs = 10_000, fetchImpl } = options;
  const result: SyncResult = {
    company: company.name,
    companyId: company.id,
    imported: 0,
    updated: 0,
    closed: 0,
    errors: [],
  };

  const client = clientFor(company.atsProvider, company.atsBoardToken ?? '', fetchImpl);
  if (!client || !company.atsBoardToken) {
    result.errors.push(`No ATS client/token for ${company.name}`);
    return result;
  }

  let candidates: EnrichedPosting[];
  try {
    const signal = AbortSignal.timeout(timeoutMs); // refinement #4
    const raw = await client.fetchPostings(company.atsBoardToken, signal);
    const normalized = raw
      .map((r) => client.toNormalized(r))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    candidates = selectCandidates(normalized, now);
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result; // do not close-missing on a failed fetch (avoids wiping data)
  }

  const liveIds: string[] = [];
  for (const posting of candidates) {
    try {
      const outcome = await sink.upsertRole({
        ...posting,
        companyId: company.id,
        companyFallbackField: company.fallbackField,
        companyHqLatitude: company.hqLatitude ?? null,
        companyHqLongitude: company.hqLongitude ?? null,
        companyHqCity: company.hqCity ?? null,
        companyHqState: company.hqState ?? null,
        companyHqCountry: company.hqCountry ?? null,
      });
      liveIds.push(posting.externalJobId);
      if (outcome === 'imported') result.imported++;
      else result.updated++;
    } catch (err) {
      result.errors.push(
        `upsert ${posting.externalJobId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
