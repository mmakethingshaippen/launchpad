import type { ProviderClient, FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { mapWorkArrangement, splitLocation } from '../util';

// https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// Returns only currently open jobs. `content` is HTML-escaped.
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  content: string; // HTML-escaped
  updated_at?: string;
  location?: { name?: string };
}

interface GreenhouseResponse {
  jobs?: GreenhouseJob[];
}

/** Greenhouse encodes HTML entities in `content`; decode the common ones. */
function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function createGreenhouseClient(fetchImpl: FetchLike = fetch): ProviderClient<GreenhouseJob> {
  return {
    provider: 'greenhouse',
    async fetchPostings(token, signal) {
      // Use content=false: the list endpoint with full descriptions can be
      // enormous for large boards (e.g. SpaceX ships ~2,700 jobs ≈ 31 MB with
      // content=true, which reliably times out). content=false returns the same
      // jobs (title/location/url) in ~2.6 MB, so every internship/co-op/associate
      // role is ingested on every run. Early-career filtering is title-only, so
      // the dropped description HTML does not affect which roles we keep.
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
        token,
      )}/jobs?content=false`;
      const res = await fetchRetrying(fetchImpl, url, { signal }, `Greenhouse ${token}`);
      if (!res.ok) throw new Error(`Greenhouse ${token}: HTTP ${res.status}`);
      const data = (await res.json()) as GreenhouseResponse;
      if (!Array.isArray(data.jobs)) throw new Error(`Greenhouse ${token}: invalid jobs response`);
      return data.jobs;
    },
    toNormalized(raw) {
      if (!raw || typeof raw.id === 'undefined' || !raw.title || !raw.absolute_url) return null;
      // Greenhouse has no workplaceType field; infer Remote from the location name.
      const locName = raw.location?.name;
      const workArrangement = mapWorkArrangement(locName);
      const loc = workArrangement === 'Remote' ? {} : splitLocation(locName);
      return {
        externalJobId: String(raw.id),
        title: raw.title,
        descriptionHtml: decodeEntities(raw.content ?? ''),
        applyUrl: raw.absolute_url,
        ...loc,
        workArrangement,
        updatedAt: raw.updated_at,
      };
    },
  };
}
