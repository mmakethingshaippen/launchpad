import type { ProviderClient, FetchLike } from '../types';
import { splitLocation } from '../util';

interface WorkdayPosting {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

interface WorkdayResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

export interface WorkdayCoords {
  host: string;
  tenant: string;
  site: string;
}

type WorkdayItem = WorkdayPosting & {
  __coords: WorkdayCoords;
};

export function parseWorkdayToken(
  token: string,
): WorkdayCoords | null {
  const parts = token.split('|');

  if (
    parts.length !== 3 ||
    parts.some((part) => !part.trim())
  ) {
    return null;
  }

  const [host, tenant, site] = parts;

  if (
    !/^[a-z0-9.-]+\.myworkday(?:jobs|site)\.com$/i.test(host)
  ) {
    return null;
  }

  return { host, tenant, site };
}

const PAGE_SIZE = 20;
const MAX_PAGES = 250;

export function createWorkdayClient(
  fetchImpl: FetchLike = fetch,
): ProviderClient<WorkdayItem> {
  let completeSnapshot = false;

  return {
    provider: 'workday',

    isCompleteSnapshot: () => completeSnapshot,

    async fetchPostings(token, signal) {
      completeSnapshot = false;

      const coords = parseWorkdayToken(token);

      if (!coords) {
        throw new Error(
          `Workday: malformed board token ${token}`,
        );
      }

      const { host, tenant, site } = coords;

      const endpoint =
        `https://${host}/wday/cxs/` +
        `${encodeURIComponent(tenant)}/` +
        `${encodeURIComponent(site)}/jobs`;

      const collected: WorkdayItem[] = [];
      const seen = new Set<string>();

      for (
        let page = 0;
        page < MAX_PAGES;
        page++
      ) {
        const offset = page * PAGE_SIZE;

        const res = await fetchImpl(endpoint, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            appliedFacets: {},
            limit: PAGE_SIZE,
            offset,
            searchText: '',
          }),
        });

        if (!res.ok) {
          throw new Error(
            `Workday ${tenant}: HTTP ${res.status} ` +
            `on page ${page + 1}`,
          );
        }

        const data =
          (await res.json()) as WorkdayResponse;

        if (!Array.isArray(data.jobPostings)) {
          throw new Error(
            `Workday ${tenant}: invalid jobs response`,
          );
        }

        let newItems = 0;

        for (const posting of data.jobPostings) {
          if (!posting?.externalPath) {
            continue;
          }

          if (seen.has(posting.externalPath)) {
            continue;
          }

          seen.add(posting.externalPath);

          collected.push({
            ...posting,
            __coords: coords,
          });

          newItems++;
        }

        if (data.jobPostings.length === 0) {
          completeSnapshot = true;
          break;
        }

        if (
          typeof data.total === 'number' &&
          offset + data.jobPostings.length >=
            data.total
        ) {
          completeSnapshot = true;
          break;
        }

        if (
          data.jobPostings.length < PAGE_SIZE
        ) {
          completeSnapshot = true;
          break;
        }

        if (newItems === 0) {
          throw new Error(
            `Workday ${tenant}: pagination ` +
            `stopped making progress`,
          );
        }
      }

      return collected;
    },

    toNormalized(raw) {
      if (
        !raw?.title ||
        !raw.externalPath
      ) {
        return null;
      }

      const { host, tenant, site } = raw.__coords;
      const onRecruitingSite = host.toLowerCase().endsWith('.myworkdaysite.com');
      const applyUrl = onRecruitingSite
        ? `https://${host}/recruiting/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}${raw.externalPath}`
        : `https://${host}/en-US/${encodeURIComponent(site)}${raw.externalPath}`;

      // Preserve the original Workday job identifier.
      // This prevents existing roles from being duplicated.
      const externalJobId =
        raw.bulletFields?.[0] ??
        raw.externalPath.split('_').pop() ??
        raw.externalPath;

      const locationText =
        (raw.locationsText ?? '').trim();

      const remote =
        /remote/i.test(locationText);

      const invalidLocation =
        !locationText ||
        /\blocations?\b/i.test(locationText) ||
        /^(location\s*)?n\/?a$/i.test(
          locationText,
        );

      const location =
        remote || invalidLocation
          ? {}
          : splitLocation(locationText);

      return {
        externalJobId,
        title: raw.title,
        descriptionHtml: '',
        applyUrl,
        ...location,
        workArrangement: remote
          ? 'Remote'
          : undefined,
        updatedAt: undefined,
      };
    },
  };
}