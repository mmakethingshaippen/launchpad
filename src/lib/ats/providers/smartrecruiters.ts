
import type { ProviderClient, FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}

interface SrPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: SrLocation;
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
  customField?: Array<{
    fieldLabel?: string;
    valueLabel?: string;
  }>;
}

interface SrResponse {
  content?: SrPosting[];
  totalFound?: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;

  const countries: Record<string, string> = {
    us: 'USA',
    ca: 'Canada',
    gb: 'UK',
    ie: 'Ireland',
    de: 'Germany',
    fr: 'France',
    in: 'India',
    sg: 'Singapore',
    au: 'Australia',
    jp: 'Japan',
  };

  return countries[code.toLowerCase()] ?? code.toUpperCase();
}

export function createSmartRecruitersClient(
  fetchImpl: FetchLike = fetch,
): ProviderClient<SrPosting> {
  let completeSnapshot = false;

  return {
    provider: 'smartrecruiters',

    isCompleteSnapshot: () => completeSnapshot,

    async fetchPostings(token, signal) {
      completeSnapshot = false;

      const collected: SrPosting[] = [];
      const seen = new Set<string>();
      let total: number | null = null;
      let reachedEnd = false;
      const missed = new Set<number>();

      const load = async (offset: number): Promise<{ data: SrResponse | null; status: number }> => {
        if (signal?.aborted) return { data: null, status: 0 };
        try {
          const url =
            `https://api.smartrecruiters.com/v1/companies/` +
            `${encodeURIComponent(token)}/postings` +
            `?limit=${PAGE_SIZE}&offset=${offset}`;
          const res = await fetchRetrying(fetchImpl, url, { signal }, `SmartRecruiters ${token} offset ${offset}`);
          if (!res.ok) return { data: null, status: res.status };
          const data = (await res.json()) as SrResponse;
          if (!Array.isArray(data.content)) return { data: null, status: res.status };
          return { data, status: res.status };
        } catch (error) {
          if (signal?.aborted) return { data: null, status: 0 };
          throw error;
        }
      };

      for (let page = 0; page < MAX_PAGES; page++) {
        if (signal?.aborted) break;
        const offset = page * PAGE_SIZE;
        const loaded = await load(offset);
        const data = loaded.data;
        if (!data) {
          if (signal?.aborted) break;
          if (page === 0 && collected.length === 0) {
            throw new Error(`SmartRecruiters ${token}: HTTP ${loaded.status} at offset 0`);
          }
          missed.add(offset);
          if (total != null && offset + PAGE_SIZE >= total) break;
          continue;
        }
        if (typeof data.totalFound === 'number') total = data.totalFound;
        for (const posting of data.content ?? []) {
          if (!posting?.id || seen.has(posting.id)) continue;
          seen.add(posting.id);
          collected.push(posting);
        }
        const count = data.content?.length ?? 0;
        if ((total != null && offset + count >= total) || count === 0 || (total == null && count < PAGE_SIZE)) {
          reachedEnd = true;
          break;
        }
      }

      for (const offset of [...missed]) {
        if (signal?.aborted) break;
        const loaded = await load(offset);
        if (!loaded.data) continue;
        missed.delete(offset);
        for (const posting of loaded.data.content ?? []) {
          if (!posting?.id || seen.has(posting.id)) continue;
          seen.add(posting.id);
          collected.push(posting);
        }
      }

      completeSnapshot = reachedEnd && missed.size === 0 && !signal?.aborted;
      return collected;
    },

    toNormalized(raw) {
      if (!raw?.id || !raw.name) return null;

      return {
        externalJobId: String(raw.id),
        title: raw.name,
        descriptionHtml: '',
        applyUrl: '',
        city: raw.location?.city,
        state: raw.location?.region,
        country: countryName(raw.location?.country),
        workArrangement: raw.location?.remote ? 'Remote' : undefined,
        employmentTypeRaw:
          raw.typeOfEmployment?.label ?? raw.department?.label,
        updatedAt: raw.releasedDate,
      };
    },
  };
}

export function createSmartRecruitersClientFor(
  token: string,
  fetchImpl: FetchLike = fetch,
): ProviderClient<SrPosting> {
  const base = createSmartRecruitersClient(fetchImpl);

  return {
    provider: 'smartrecruiters',

    isCompleteSnapshot: () => base.isCompleteSnapshot?.() === true,

    fetchPostings: (board, signal) =>
      base.fetchPostings(board, signal),

    toNormalized(raw) {
      const normalized = base.toNormalized(raw);
      if (!normalized) return null;

      return {
        ...normalized,
        applyUrl:
          `https://jobs.smartrecruiters.com/` +
          `${encodeURIComponent(token)}/${normalized.externalJobId}`,
      };
    },
  };
}
