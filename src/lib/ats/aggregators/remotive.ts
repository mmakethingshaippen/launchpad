import type { FetchLike } from '../types';
import type { AggregatedPosting, AggregatorClient } from './types';
import { isEarlyCareerTitle } from '../classify';

// Remotive public remote-jobs API (keyless):
//   https://remotive.com/api/remote-jobs
interface RemotiveJob {
  id: number;
  title: string;
  company_name?: string;
  company_logo?: string;
  url?: string;
  candidate_required_location?: string;
  job_type?: string;
  category?: string;
  publication_date?: string;
  description?: string; // HTML
}
interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

export function createRemotiveClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  let feedComplete = false;
  return {
    source: 'remotive',
    feedWasComplete: () => feedComplete,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      const url = 'https://remotive.com/api/remote-jobs';
      const res = await fetchImpl(url, { signal });
      if (!res.ok) throw new Error(`Remotive: HTTP ${res.status}`);
      const data = (await res.json()) as RemotiveResponse;

      const out: AggregatedPosting[] = [];
      for (const j of data.jobs ?? []) {
        if (!j.title || !j.company_name || !j.url) continue;
        // Strict title-level early-career gate (A1 seniority + A2 recruiter + B).
        if (!isEarlyCareerTitle(j.title)) continue;

        out.push({
          source: 'remotive',
          companyName: j.company_name,
          externalJobId: `remotive-${j.id}`,
          title: j.title,
          descriptionHtml: j.description ?? '',
          applyUrl: j.url,
          // Remotive roles are remote by definition.
          workArrangement: 'Remote',
          employmentTypeRaw: j.job_type ?? j.category,
          updatedAt: j.publication_date,
        });
      }
      feedComplete = true;
      return out;
    },
  };
}
