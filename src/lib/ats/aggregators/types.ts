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

/** What the last fetch actually read, for run logs. */
export interface FeedReport {
  complete: boolean;
  pagesRead: number;
  /** Why paging ended, including every reason that made the feed incomplete. */
  stopReason: string;
  /**
   * Set only when the source served an explicit access challenge (see
   * accessChallenge.ts). A plain HTTP error does not set this.
   */
  blocked?: { status: number; vendor: string; evidence: string };
}

export interface AggregatorClient {
  readonly source: AggregatorSource;
  fetchEarlyCareer(signal?: AbortSignal): Promise<AggregatedPosting[]>;
  /** True only when the last fetch read the whole feed. Absent or false must not close older rows. */
  feedWasComplete?(): boolean;
  /**
   * True only for a source whose feed is the employer-neutral inventory of every
   * open listing, where absence really means closed. Keyword searches, category
   * or level facets and result-capped APIs are filtered views: a listing can drop
   * out of them and still be open. Absent or false means absence never closes a row;
   * the fallback page verification decides instead.
   */
  readonly exhaustiveInventory?: boolean;
  /** Optional detail behind feedWasComplete for logging. */
  feedReport?(): FeedReport;
}
