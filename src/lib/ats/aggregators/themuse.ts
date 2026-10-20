import type { FetchLike } from '../types';
import type { AggregatedPosting, AggregatorClient } from './types';
import { isEarlyCareerTitle } from '../classify';
import { splitLocation } from '../util';

// The Muse public jobs API (keyless):
//   https://www.themuse.com/api/public/jobs?level=Internship&page=1
//   https://www.themuse.com/api/public/jobs?level=Entry%20Level&page=1
interface MuseJob {
  id: number;
  name: string; // title
  contents?: string; // HTML description
  refs?: { landing_page?: string };
  company?: { name?: string; short_name?: string };
  locations?: Array<{ name?: string }>;
  levels?: Array<{ name?: string }>;
  categories?: Array<{ name?: string }>;
  publication_date?: string;
}
interface MuseResponse {
  results?: MuseJob[];
  page_count?: number;
}

// Keep tech/data/finance/operations-relevant roles (Req: filter for relevance).
const RELEVANT_CATEGORY_RE =
  /\b(engineering|software|data|it|information technology|science|finance|accounting|business|operations|product|design|analytics|marketing)\b/i;

const LEVELS = ['Internship', 'Entry Level'];
const PAGES_PER_LEVEL = 2; // keep the request count bounded

export function createTheMuseClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  return {
    source: 'themuse',
    async fetchEarlyCareer(signal) {
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>(); // dedup across level/page queries
      for (const level of LEVELS) {
        for (let page = 1; page <= PAGES_PER_LEVEL; page++) {
          const url = `https://www.themuse.com/api/public/jobs?level=${encodeURIComponent(level)}&page=${page}`;
          let res;
          try {
            res = await fetchImpl(url, { signal });
          } catch {
            break; // network error on this level: move on
          }
          if (!res.ok) break;
          const data = (await res.json()) as MuseResponse;
          for (const j of data.results ?? []) {
            const companyName = j.company?.name ?? j.company?.short_name;
            if (!companyName || !j.name) continue;

            const categoryText = (j.categories ?? []).map((c) => c.name).join(' ');
            if (categoryText && !RELEVANT_CATEGORY_RE.test(categoryText)) continue;

            // Strict title-level early-career gate — the Muse "level" facet alone
            // is not enough (it tags full-time "Entry Level" recruiter roles too).
            const levelNames = (j.levels ?? []).map((l) => l.name).join(' ');
            if (!isEarlyCareerTitle(j.name)) continue;

            const applyUrl = j.refs?.landing_page;
            if (!applyUrl) continue;

            const externalJobId = `muse-${j.id}`;
            if (seen.has(externalJobId)) continue;
            seen.add(externalJobId);

            const loc = splitLocation(j.locations?.[0]?.name);
            const remote = /remote|flexible/i.test(j.locations?.[0]?.name ?? '');
            out.push({
              source: 'themuse',
              companyName,
              externalJobId,
              title: j.name,
              descriptionHtml: j.contents ?? '',
              applyUrl,
              ...loc,
              workArrangement: remote ? 'Remote' : undefined,
              employmentTypeRaw: levelNames,
              updatedAt: j.publication_date,
            });
          }
          if ((data.page_count ?? 0) <= page) break;
        }
      }
      return out;
    },
  };
}
