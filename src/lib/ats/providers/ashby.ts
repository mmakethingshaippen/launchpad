import type { NormalizedPosting, ProviderClient, FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { mapWorkArrangement, normalizePayPeriod, splitLocation } from '../util';

// https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true
interface AshbyCompensationComponent {
  minValue?: number;
  maxValue?: number;
  currencyCode?: string;
  interval?: string; // e.g. '1 YEAR', '1 HOUR'
}
interface AshbyCompensationTier {
  components?: AshbyCompensationComponent[];
}
interface AshbyPosting {
  id: string;
  title: string;
  isListed?: boolean;
  location?: string;
  workplaceType?: string;
  employmentType?: string;
  applyUrl?: string;
  jobUrl?: string;
  descriptionHtml?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: AshbyCompensationComponent[];
    compensationTiers?: AshbyCompensationTier[];
  };
  updatedAt?: string;
  publishedAt?: string;
}
interface AshbyResponse {
  jobs?: AshbyPosting[];
}

function extractPay(c: AshbyPosting['compensation']): NormalizedPosting['pay'] | undefined {
  const comp = c?.summaryComponents?.[0] ?? c?.compensationTiers?.[0]?.components?.[0];
  if (!comp) return undefined;
  const period = comp.interval ? normalizePayPeriod(comp.interval.split(' ').pop()) : undefined;
  if (comp.minValue == null && comp.maxValue == null) return undefined;
  return {
    min: comp.minValue,
    max: comp.maxValue,
    currency: comp.currencyCode,
    period,
  };
}

export function createAshbyClient(fetchImpl: FetchLike = fetch): ProviderClient<AshbyPosting> {
  return {
    provider: 'ashby',
    async fetchPostings(token, signal) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
        token,
      )}?includeCompensation=true`;
      const res = await fetchRetrying(fetchImpl, url, { signal }, `Ashby ${token}`);
      if (!res.ok) throw new Error(`Ashby ${token}: HTTP ${res.status}`);
      const data = (await res.json()) as AshbyResponse;
      if (!Array.isArray(data.jobs)) throw new Error(`Ashby ${token}: invalid jobs response`);
      return data.jobs;
    },
    toNormalized(raw) {
      // Strictly require isListed === true (Req 17.3).
      if (!raw || raw.isListed !== true) return null;
      if (!raw.id || !raw.title) return null;
      const applyUrl = raw.applyUrl ?? raw.jobUrl;
      if (!applyUrl) return null;
      const loc = splitLocation(raw.location);
      return {
        externalJobId: String(raw.id),
        title: raw.title,
        descriptionHtml: raw.descriptionHtml ?? '',
        applyUrl,
        ...loc,
        workArrangement: mapWorkArrangement(raw.workplaceType),
        employmentTypeRaw: raw.employmentType,
        pay: extractPay(raw.compensation),
        updatedAt: raw.updatedAt ?? raw.publishedAt,
      };
    },
  };
}
