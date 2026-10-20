import type { ProviderClient, FetchLike } from '../types';
import { mapWorkArrangement, splitLocation } from '../util';

// Workable exposes a keyless public jobs widget:
//   https://www.workable.com/api/accounts/{token}?details=false
// returning { name, description, jobs: [{ shortcode, title, ... }] }.
// The v3 search API (apply.workable.com/api/v3/accounts/{token}/jobs, POST)
// is used as a fallback when the widget API is unavailable.
interface WorkableWidgetJob {
  id?: string;
  shortcode?: string;
  title: string;
  url?: string;
  application_url?: string;
  shortlink?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    country_code?: string;
    telecommuting?: boolean;
  };
  department?: string;
  employment_type?: string;
  created_at?: string;
}
interface WorkableWidgetResponse {
  jobs?: WorkableWidgetJob[];
}

// v3 search API shapes (fallback).
interface WorkableV3Job {
  id?: string;
  shortcode?: string;
  title: string;
  url?: string;
  locations?: Array<{ city?: string; region?: string; country?: string }>;
  remote?: boolean;
  department?: string[];
  created_at?: string;
}
interface WorkableV3Response {
  results?: WorkableV3Job[];
}

export function createWorkableClient(fetchImpl: FetchLike = fetch): ProviderClient<WorkableWidgetJob> {
  return {
    provider: 'workable',
    async fetchPostings(token, signal) {
      const widgetUrl = `https://www.workable.com/api/accounts/${encodeURIComponent(token)}?details=false`;
      const res = await fetchImpl(widgetUrl, { signal });
      if (res.ok) {
        const data = (await res.json()) as WorkableWidgetResponse;
        if (data.jobs?.length) return data.jobs;
      }

      // Fallback: v3 search API (POST). Normalize its shape into the widget shape.
      const v3Url = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(token)}/jobs`;
      const v3 = await fetchImpl(v3Url, {
        signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '', location: [], department: [], worktype: [], remote: [] }),
      });
      if (!v3.ok) throw new Error(`Workable ${token}: HTTP ${res.status}/${v3.status}`);
      const v3data = (await v3.json()) as WorkableV3Response;
      return (v3data.results ?? []).map((j) => ({
        shortcode: j.shortcode ?? j.id,
        title: j.title,
        url: j.url,
        location: j.locations?.[0]
          ? { ...j.locations[0], telecommuting: j.remote }
          : { telecommuting: j.remote },
        department: j.department?.[0],
        created_at: j.created_at,
      }));
    },
    toNormalized(raw) {
      if (!raw || !raw.title) return null;
      const code = raw.shortcode ?? raw.id;
      if (!code) return null;
      const applyUrl =
        raw.application_url ??
        raw.url ??
        raw.shortlink ??
        `https://apply.workable.com/j/${code}`;
      const loc = raw.location;
      const locationString = [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ');
      const parts = splitLocation(locationString);
      return {
        externalJobId: String(code),
        title: raw.title,
        descriptionHtml: '',
        applyUrl,
        ...parts,
        workArrangement: loc?.telecommuting ? 'Remote' : mapWorkArrangement(undefined),
        employmentTypeRaw: raw.employment_type ?? raw.department,
        updatedAt: raw.created_at,
      };
    },
  };
}
