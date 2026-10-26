import type { NormalizedPosting } from '../types';

/**
 * Aggregator feeds (The Muse, Remotive) are global, not per-company. Each item
 * carries its own company name/landing-site so we can attach roles to the right
 * company (matched by name, else grouped under an aggregator-sourced company).
 */
export type AggregatorSource =
  | 'themuse'
  | 'remotive'
  | 'adzuna'
  | 'simplify'
  | 'usajobs'
  | 'amazon';

export interface AggregatedPosting extends NormalizedPosting {
  companyName: string;
  companyWebsite?: string;
  source: AggregatorSource;
}

export interface AggregatorClient {
  readonly source: AggregatorSource;
  fetchEarlyCareer(signal?: AbortSignal): Promise<AggregatedPosting[]>;
  /** True only when the last fetch read the whole feed. Absent or false must not close older rows. */
  feedWasComplete?(): boolean;
}
