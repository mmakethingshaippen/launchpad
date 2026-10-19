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

/** A provider adapter: fetch raw postings, then map each to NormalizedPosting. */
export interface ProviderClient<Raw = unknown> {
  readonly provider: 'greenhouse' | 'ashby' | 'lever';
  fetchPostings(token: string, signal?: AbortSignal): Promise<Raw[]>;
  toNormalized(raw: Raw): NormalizedPosting | null;
}

export interface FetchLike {
  (input: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}
