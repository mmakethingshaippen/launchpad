import type { FetchLike } from '../types';
import { fetchRetrying } from '../fetchRetry';
import type { AggregatedPosting, AggregatorClient, FeedReport } from './types';
import { describeJsonFailure, readJsonResponse } from '../jsonResponse';
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
  'job-count'?: number;
  'total-job-count'?: number;
}

export function createRemotiveClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  let feedComplete = false;
  let report: FeedReport = { complete: false, pagesRead: 0, stopReason: 'not fetched yet' };
  return {
    source: 'remotive',
    feedWasComplete: () => feedComplete,
    feedReport: () => report,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      const url = 'https://remotive.com/api/remote-jobs';
      const res = await fetchRetrying(fetchImpl, url, { signal }, 'Remotive');
      const read = await readJsonResponse<RemotiveResponse>(res, url);
      if (!read.ok) throw new Error(`Remotive: ${describeJsonFailure(read)}`);
      const data = read.data;
      if (!data || !Array.isArray(data.jobs)) throw new Error('Remotive: unexpected response (no jobs array)');

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
      // Report the raw size so an empty result after filtering is distinguishable from a broken request.
      const total = data['total-job-count'];
      report = {
        complete: true,
        pagesRead: 1,
        stopReason: `API returned ${data.jobs.length} job(s)${typeof total === 'number' ? ` (total-job-count ${total})` : ''}; ${out.length} early-career`,
      };
      return out;
    },
  };
}
