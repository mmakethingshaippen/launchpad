import type { ProviderClient, FetchLike } from '../types';

// https://api.smartrecruiters.com/v1/companies/{token}/postings?limit=100
// Public, keyless postings feed. Returns a paginated { content: [...] } list.
interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
}
interface SrPosting {
  id: string;
  name: string; // title
  releasedDate?: string;
  location?: SrLocation;
  department?: { label?: string };
  typeOfEmployment?: { label?: string };
  customField?: Array<{ fieldLabel?: string; valueLabel?: string }>;
}
interface SrResponse {
  content?: SrPosting[];
}

function countryName(code: string | undefined): string | undefined {
  if (!code) return undefined;
  // SmartRecruiters uses ISO-3166 alpha-2 codes; map the common ones, else keep.
  const map: Record<string, string> = {
    us: 'USA',
    ca: 'Canada',
    gb: 'UK',
    uk: 'UK',
    ie: 'Ireland',
    de: 'Germany',
    fr: 'France',
    in: 'India',
    sg: 'Singapore',
    au: 'Australia',
    jp: 'Japan',
  };
  return map[code.toLowerCase()] ?? code.toUpperCase();
}

export function createSmartRecruitersClient(
  fetchImpl: FetchLike = fetch,
): ProviderClient<SrPosting> {
  return {
    provider: 'smartrecruiters',
    isCompleteSnapshot: () => false, // Current connector reads only the first page.
    async fetchPostings(token, signal) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
        token,
      )}/postings?limit=100`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`SmartRecruiters ${token}: HTTP ${res.status}`);
      const data = (await res.json()) as SrResponse;
      return data.content ?? [];
    },
    toNormalized(raw) {
      if (!raw || !raw.id || !raw.name) return null;
      // The company token is needed for the apply URL; SmartRecruiters embeds it
      // in the posting feed path, but not on each item — reconstruct a stable
      // public apply URL using the posting id. Consumers pass the token via the
      // closure below (see createSmartRecruitersClientFor).
      return {
        externalJobId: String(raw.id),
        title: raw.name,
        descriptionHtml: '',
        applyUrl: '', // filled by the token-bound wrapper
        city: raw.location?.city,
        state: raw.location?.region,
        country: countryName(raw.location?.country),
        workArrangement: raw.location?.remote ? 'Remote' : undefined,
        employmentTypeRaw: raw.typeOfEmployment?.label ?? raw.department?.label,
        updatedAt: raw.releasedDate,
      };
    },
  };
}

/**
 * SmartRecruiters apply URLs require the company token, which isn't on each
 * posting. This token-bound variant builds the correct public apply URL:
 *   https://jobs.smartrecruiters.com/{token}/{id}
 */
export function createSmartRecruitersClientFor(
  token: string,
  fetchImpl: FetchLike = fetch,
): ProviderClient<SrPosting> {
  const base = createSmartRecruitersClient(fetchImpl);
  return {
    provider: 'smartrecruiters',
    isCompleteSnapshot: () => base.isCompleteSnapshot?.() === true,
    fetchPostings: (t, signal) => base.fetchPostings(t, signal),
    toNormalized(raw) {
      const normalized = base.toNormalized(raw);
      if (!normalized) return null;
      return {
        ...normalized,
        applyUrl: `https://jobs.smartrecruiters.com/${encodeURIComponent(token)}/${normalized.externalJobId}`,
      };
    },
  };
}
