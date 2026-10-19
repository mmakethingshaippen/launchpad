import type { NormalizedPosting, ProviderClient, FetchLike } from '../types';
import { mapWorkArrangement, normalizePayPeriod, splitLocation } from '../util';

// https://api.lever.co/v0/postings/{token}?mode=json
interface LeverSalaryRange {
  min?: number;
  max?: number;
  currency?: string;
  interval?: string; // e.g. 'per-year-salary'
}
interface LeverPosting {
  id: string;
  text: string; // title
  hostedUrl?: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string; // HTML
  workplaceType?: string;
  categories?: {
    location?: string;
    commitment?: string; // Full-time / Part-time / Intern
    team?: string;
  };
  salaryRange?: LeverSalaryRange;
  createdAt?: number;
}

function extractPay(s: LeverSalaryRange | undefined): NormalizedPosting['pay'] | undefined {
  if (!s || (s.min == null && s.max == null)) return undefined;
  const period = s.interval ? normalizePayPeriod(s.interval) : undefined;
  return { min: s.min, max: s.max, currency: s.currency, period };
}

export function createLeverClient(fetchImpl: FetchLike = fetch): ProviderClient<LeverPosting> {
  return {
    provider: 'lever',
    async fetchPostings(token, signal) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`Lever ${token}: HTTP ${res.status}`);
      const data = (await res.json()) as LeverPosting[];
      return Array.isArray(data) ? data : [];
    },
    toNormalized(raw) {
      if (!raw || !raw.id || !raw.text) return null;
      const applyUrl = raw.applyUrl ?? raw.hostedUrl;
      if (!applyUrl) return null;
      const loc = splitLocation(raw.categories?.location);
      return {
        externalJobId: String(raw.id),
        title: raw.text,
        descriptionHtml: raw.description ?? raw.descriptionPlain ?? '',
        applyUrl,
        ...loc,
        workArrangement: mapWorkArrangement(raw.workplaceType),
        employmentTypeRaw: raw.categories?.commitment,
        pay: extractPay(raw.salaryRange),
        updatedAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : undefined,
      };
    },
  };
}
