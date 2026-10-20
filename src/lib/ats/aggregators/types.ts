import type { NormalizedPosting } from '../types';

/**
 * Aggregator feeds (The Muse, Remotive) are global, not per-company. Each item
 * carries its own company name/landing-site so we can attach roles to the right
 * company (matched by name, else grouped under an aggregator-sourced company).
 */
export interface AggregatedPosting extends NormalizedPosting {
  companyName: string;
  companyWebsite?: string;
  source: 'themuse' | 'remotive';
}

export interface AggregatorClient {
  readonly source: 'themuse' | 'remotive';
  fetchEarlyCareer(signal?: AbortSignal): Promise<AggregatedPosting[]>;
}
