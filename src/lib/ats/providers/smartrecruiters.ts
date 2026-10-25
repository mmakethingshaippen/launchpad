
import type { ProviderClient, FetchLike } from '../types';

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

      for (let page = 0; page < MAX_PAGES; page++) {
        const offset = page * PAGE_SIZE;

        const url =
          `https://api.smartrecruiters.com/v1/companies/` +
          `${encodeURIComponent(token)}/postings` +
          `?limit=${PAGE_SIZE}&offset=${offset}`;

        const res = await fetchImpl(url, { signal });

        if (!res.ok) {
          throw new Error(
            `SmartRecruiters ${token}: HTTP ${res.status} at offset ${offset}`,
          );
        }

        const data = (await res.json()) as SrResponse;

        if (!Array.isArray(data.content)) {
          throw new Error(
            `SmartRecruiters ${token}: invalid postings response`,
          );
        }

        let newItems = 0;

        for (const posting of data.content) {
          if (!posting?.id || seen.has(posting.id)) continue;

          seen.add(posting.id);
          collected.push(posting);
          newItems++;
        }

        if (data.content.length === 0) {
          completeSnapshot = true;
          break;
        }

        if (
          typeof data.totalFound === 'number' &&
          offset + data.content.length >= data.totalFound
        ) {
          completeSnapshot = true;
          break;
        }

        if (data.content.length < PAGE_SIZE) {
          completeSnapshot = true;
          break;
        }

        if (newItems === 0) {
          throw new Error(
            `SmartRecruiters ${token}: pagination stopped making progress`,
          );
        }
      }

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
