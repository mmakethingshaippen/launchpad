import type { ProviderClient, FetchLike } from '../types';
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
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
        token,
      )}/jobs?content=true`;
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`Greenhouse ${token}: HTTP ${res.status}`);
      const data = (await res.json()) as GreenhouseResponse;
      return data.jobs ?? [];
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
