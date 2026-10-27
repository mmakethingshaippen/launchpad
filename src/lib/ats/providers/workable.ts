
import type { ProviderClient, FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { mapWorkArrangement, splitLocation } from '../util';

interface WorkableLocation {
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  telecommuting?: boolean;
}

interface WorkableJob {
  id?: string;
  shortcode?: string;
  title: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  location?: WorkableLocation;
  department?: string;
  employment_type?: string;
  created_at?: string;
}

interface WidgetResponse {
  jobs?: WorkableJob[];
}

interface V3Job {
  id?: string;
  shortcode?: string;
  title: string;
  url?: string;
  locations?: Array<{
    city?: string;
    region?: string;
    country?: string;
  }>;
  remote?: boolean;
  department?: string[];
  created_at?: string;
}

interface V3Response {
  results?: V3Job[];
  paging?: {
    next?: string | null;
  };
  next?: string | null;
}

const MAX_FALLBACK_PAGES = 100;

export function createWorkableClient(
  fetchImpl: FetchLike = fetch,
): ProviderClient<WorkableJob> {
  let completeSnapshot = false;

  return {
    provider: 'workable',

    isCompleteSnapshot: () => completeSnapshot,

    async fetchPostings(token, signal) {
      completeSnapshot = false;

      const widgetUrl =
        `https://www.workable.com/api/accounts/` +
        `${encodeURIComponent(token)}?details=false`;

      const widgetResponse = await fetchRetrying(
        fetchImpl,
        widgetUrl,
        { signal },
        `Workable ${token}`,
      );

      if (widgetResponse.ok) {
        const data =
          (await widgetResponse.json()) as WidgetResponse;

        // An empty widget response must trigger the v3
        // fallback rather than returning zero jobs.
        if (
          Array.isArray(data.jobs) &&
          data.jobs.length > 0
        ) {
          completeSnapshot = true;
          return data.jobs;
        }
      }

      const endpoint =
        `https://apply.workable.com/api/v3/accounts/` +
        `${encodeURIComponent(token)}/jobs`;

      const collected: WorkableJob[] = [];
      const seen = new Set<string>();
      const visitedCursors = new Set<string>();

      let cursor: string | null = null;

      for (
        let page = 0;
        page < MAX_FALLBACK_PAGES;
        page++
      ) {
        const body: Record<string, unknown> = {
          query: '',
          location: [],
          department: [],
          worktype: [],
          remote: [],
        };

        if (cursor) {
          body.cursor = cursor;
        }

        const res = await fetchRetrying(
          fetchImpl,
          endpoint,
          {
            signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(body),
          },
          `Workable ${token}`,
        );

        if (!res.ok) {
          if (collected.length > 0) {
            console.log(
              `Workable ${token}: HTTP ${res.status}; keeping ${collected.length} jobs already read`,
            );
            break;
          }
          throw new Error(
            `Workable ${token}: fallback HTTP ${res.status}`,
          );
        }

        const data = (await res.json()) as V3Response;

        if (!Array.isArray(data.results)) {
          throw new Error(
            `Workable ${token}: invalid fallback response`,
          );
        }

        for (const job of data.results) {
          const id = job.shortcode ?? job.id;

          if (!id || seen.has(id)) {
            continue;
          }

          seen.add(id);

          collected.push({
            id: job.id,
            shortcode: job.shortcode ?? job.id,
            title: job.title,
            url: job.url,
            location: job.locations?.[0]
              ? {
                  ...job.locations[0],
                  telecommuting: job.remote,
                }
              : {
                  telecommuting: job.remote,
                },
            department: job.department?.[0],
            created_at: job.created_at,
          });
        }

        const nextCursor =
          data.paging?.next ?? data.next ?? null;

        if (!nextCursor) {
          break;
        }

        if (visitedCursors.has(nextCursor)) {
          throw new Error(
            `Workable ${token}: pagination cursor repeated`,
          );
        }

        visitedCursors.add(nextCursor);
        cursor = nextCursor;
      }

      // Fallback responses may be incomplete.
      // Never close missing jobs based on this feed.
      completeSnapshot = false;

      return collected;
    },

    toNormalized(raw) {
      if (!raw?.title) {
        return null;
      }

      const id = raw.shortcode ?? raw.id;

      if (!id) {
        return null;
      }

      const applyUrl =
        raw.application_url ??
        raw.url ??
        raw.shortlink ??
        `https://apply.workable.com/j/${id}`;

      const location = raw.location;

      const locationText = [
        location?.city,
        location?.region,
        location?.country,
      ]
        .filter(Boolean)
        .join(', ');

      return {
        externalJobId: String(id),
        title: raw.title,
        descriptionHtml: '',
        applyUrl,
        ...splitLocation(locationText),
        workArrangement: location?.telecommuting
          ? 'Remote'
          : mapWorkArrangement(undefined),
        employmentTypeRaw:
          raw.employment_type ?? raw.department,
        updatedAt: raw.created_at,
      };
    },
  };
}
