import type { WorkArrangement } from '../adapter/types';

/** Common normalized shape produced by every provider adapter. */
export interface NormalizedPosting {
  externalJobId: string;
  title: string;
  descriptionHtml: string; // raw; sanitized at render time (never here)
  applyUrl: string;
  city?: string;
  state?: string;
  country?: string;
  workArrangement?: WorkArrangement;
  employmentTypeRaw?: string;
  pay?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: string; // 'hour' | 'month' | 'year'
  };
  updatedAt?: string;
}

export type ProviderName =
  | 'greenhouse'
  | 'ashby'
  | 'lever'
  | 'smartrecruiters'
  | 'workable'
  | 'workday'
  | 'adzuna';

/** A provider adapter: fetch raw postings, then map each to NormalizedPosting. */
export interface ProviderClient<Raw = unknown> {
  readonly provider: ProviderName;
  fetchPostings(token: string, signal?: AbortSignal): Promise<Raw[]>;
  toNormalized(raw: Raw): NormalizedPosting | null;
}

/**
 * Minimal fetch surface used by provider adapters. Supports GET (default) and
 * POST with a JSON body/headers (needed by Workable's v3 search API).
 */
export interface FetchLike {
  (
    input: string,
    init?: {
      signal?: AbortSignal;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}
