import type { FetchLike, ProviderClient, ProviderCoverage } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { detectAccessChallenge } from '../accessChallenge';
import { mapWorkArrangement } from '../util';

const TOKEN = 'cvshealth.wd1.myworkdayjobs.com|cvshealth|cvs_health_careers';
export const isCvsWorkdayToken = (token: string) => token.toLowerCase() === TOKEN;

interface CvsJob {
  reqId: string;
  jobId: string;
  title: string;
  applyUrl: string;
  city?: string;
  state?: string;
  country?: string;
  remote?: string;
  type?: string;
}

/** Parse the site's public embedded data as JSON, never as executable script. */
function searchData(html: string): { status: number; totalHits: number; data: { jobs: CvsJob[] } } {
  const assignment = /\bphApp\.ddo\s*=\s*\{/.exec(html);
  if (!assignment) throw new Error('Missing public search data');
  const start = assignment.index + assignment[0].lastIndexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      return JSON.parse(html.slice(start, i + 1)).eagerLoadRefineSearch;
    }
  }
  throw new Error('Truncated public search data');
}

function isJob(value: unknown): value is CvsJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as CvsJob;
  if (typeof job.reqId !== 'string' || !/^R\d+$/.test(job.reqId) || job.reqId !== job.jobId ||
      typeof job.title !== 'string' || !job.title.trim() || typeof job.applyUrl !== 'string') return false;
  try {
    const url = new URL(job.applyUrl);
    return url.protocol === 'https:' && url.hostname === 'cvshealth.wd1.myworkdayjobs.com' &&
      url.pathname.startsWith('/CVS_Health_Careers/job/') &&
      new RegExp(`_${job.reqId}(?:-\\d+)?/apply$`).test(url.pathname) &&
      ['city', 'state', 'country', 'remote', 'type'].every(key => job[key as keyof CvsJob] == null || typeof job[key as keyof CvsJob] === 'string');
  } catch { return false; }
}

export function createCvsClient(fetchImpl: FetchLike = fetch): ProviderClient<CvsJob> {
  let coverage: ProviderCoverage = { status: 'partial', host: 'jobs.cvshealth.com', reason: 'Not downloaded' };
  return {
    provider: 'workday', isCompleteSnapshot: () => false, getFetchCoverage: () => coverage,
    async fetchPostings(token, signal) {
      if (!isCvsWorkdayToken(token)) throw new Error('CVS careers: unsupported employer token');
      coverage = { status: 'partial', host: 'jobs.cvshealth.com', reason: 'Download not finished' };
      const jobs = new Map<string, CvsJob>();
      const seen = new Set<string>();
      let unmapped = 0;
      const finish = () => {
        coverage = { status: unmapped ? 'partial' : 'filtered', host: 'jobs.cvshealth.com', reason: unmapped ?
          `CVS public internship search completed; ${unmapped} postings had no matching CVS Workday requisition and were left unverified` :
          'CVS public internship search completed; absent jobs require separate verification' };
        return [...jobs.values()];
      };
      let offset = 0, expected: number | undefined, changed = false;
      try {
        for (let page = 0; page < 400; page++) {
          signal?.throwIfAborted();
          if (page && !process.env.VITEST) {
            await new Promise(resolve => setTimeout(resolve, 1100));
            signal?.throwIfAborted();
          }
          // The site's generic next-page link adds s=1, which makes its server
          // ignore keywords and return the unfiltered board. Keep keywords on
          // the URL without that switch so later pages stay in the same search.
          const params = new URLSearchParams({ keywords: 'intern', from: String(offset) });
          const response = await fetchRetrying(fetchImpl, `https://jobs.cvshealth.com/us/en/search-results?${params}`, { signal }, 'CVS careers');
          const html = response.text ? await response.text() : '';
          const challenge = detectAccessChallenge(response.status, response.headers, html.slice(0, 20000));
          if (challenge) { coverage.status = 'blocked'; throw new Error(`access-challenge: ${challenge}`); }
          if (!response.ok) throw new Error(`http-${response.status}`);
          const result = searchData(html);
          if (!result || result.status !== 200 || !Number.isSafeInteger(result.totalHits) || result.totalHits < 0 ||
              !Array.isArray(result.data?.jobs) || !result.data.jobs.every(job => job && typeof job === 'object' &&
                typeof job.jobId === 'string' && Boolean(job.jobId.trim()))) throw new Error('Invalid public search response');
          if (expected !== undefined && expected !== result.totalHits) changed = true;
          expected = result.totalHits;
          const rows = result.data.jobs;
          if (!rows.length) {
            if (seen.size !== expected || changed) throw new Error('Search count changed or pagination missed jobs');
            return finish();
          }
          const before = seen.size;
          for (const row of rows) {
            if (seen.has(row.jobId)) continue;
            seen.add(row.jobId);
            if (isJob(row)) jobs.set(row.reqId, row);
            else unmapped++;
          }
          if (seen.size === before) throw new Error('Repeated search page');
          offset += rows.length;
          if (seen.size === expected && offset >= expected && !changed) {
            return finish();
          }
        }
        throw new Error('Search page limit reached');
      } catch (error) {
        coverage.reason = `CVS careers: ${error instanceof Error ? error.message : String(error)}`;
        if (!jobs.size) throw new Error(coverage.reason);
        return [...jobs.values()];
      }
    },
    toNormalized(job) {
      if (!isJob(job)) return null;
      return { externalJobId: job.reqId, title: job.title, applyUrl: job.applyUrl,
        descriptionHtml: '', city: job.city, state: job.state, country: job.country,
        workArrangement: mapWorkArrangement(job.remote), employmentTypeRaw: job.type };
    },
  };
}
