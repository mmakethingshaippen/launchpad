import { createHash } from 'node:crypto';
import type { FetchLike } from '../types';
import type { AggregatedPosting, AggregatorClient, FeedReport } from './types';
import { isEarlyCareerTitle } from '../classify';
import { detectAccessChallenge } from '../accessChallenge';
import { readJsonResponse, describeJsonFailure } from '../jsonResponse';
import { isValidHttpUrl } from '../util';
import { normalizeText, titleMatches } from './pageEvidence';

/** Public, server-side API. https://himalayas.app/api. Never crawl Apply links. */
const ORIGIN = 'https://himalayas.app';
const QUERIES: Array<Record<string, string>> = [{ employment_type: 'Intern' }, { q: 'new grad' }, { q: 'entry level' }, { q: 'co-op' }];

interface HimalayasJob {
  guid?: string;
  title?: string;
  companyName?: string;
  applicationLink?: string;
  employmentType?: string;
  description?: string;
  excerpt?: string;
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  currency?: string | null;
  pubDate?: number;
  expiryDate?: number;
}

export function himalayasJobUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:' || url.hostname !== 'himalayas.app' || url.username || url.password) return null;
    if (!/^\/companies\/[^/]+\/jobs\/[^/]+\/?$/.test(url.pathname)) return null;
    return `${ORIGIN}${url.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value * 1000 <= 8.64e15 ? value * 1000 : null;
}
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function normalize(job: HimalayasJob, now: Date): AggregatedPosting | null {
  const guid = himalayasJobUrl(job.guid);
  const expiry = seconds(job.expiryDate);
  if (!guid || !job.title || !job.companyName || !isValidHttpUrl(job.applicationLink)) return null;
  if (!isEarlyCareerTitle(job.title) || expiry === null || expiry <= now.getTime()) return null;
  const countries = (job.locationRestrictions ?? []).filter(c => typeof c === 'string' && c.trim());
  const zones = (job.timezoneRestrictions ?? []).filter(n => typeof n === 'number' && Number.isFinite(n));
  const restrictions = [
    `Eligible locations: ${countries.length ? countries.join(', ') : 'Worldwide'}.`,
    ...(zones.length ? [`Eligible UTC offsets: ${zones.join(', ')}. Check the source listing for eligibility.`] : []),
  ].join(' ');
  const salary = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
  const min = salary(job.minSalary), max = salary(job.maxSalary);
  return {
    source: 'himalayas', companyName: job.companyName,
    // Fixed-length, stable identity avoids URL-derived slugs colliding at the 80-character limit.
    externalJobId: `himalayas-${createHash('sha256').update(guid).digest('hex').slice(0, 24)}`,
    title: job.title, descriptionHtml: `<p>${escapeHtml(restrictions)}</p>${job.description ?? job.excerpt ?? ''}`,
    // API terms require preserving this link, including its tracking parameters.
    applyUrl: job.applicationLink!, sourceUrl: guid,
    country: countries.length ? countries.join(', ') : undefined,
    workArrangement: 'Remote', employmentTypeRaw: job.employmentType,
    deadline: new Date(expiry).toISOString(),
    ...(min !== undefined || max !== undefined ? { pay: { min, max, currency: job.currency ?? undefined, period: job.salaryPeriod ?? 'annual' } } : {}),
    updatedAt: seconds(job.pubDate) ? new Date(seconds(job.pubDate)!).toISOString() : undefined,
  };
}

export function createHimalayasClient(
  fetchImpl: FetchLike = fetch,
  opts: { now?: Date; apiKey?: string; maxPages?: number; requestDelayMs?: number } = {},
): AggregatorClient {
  let report: FeedReport = { complete: false, pagesRead: 0, stopReason: 'not fetched yet' };
  return {
    source: 'himalayas', feedTimeoutMs: 5 * 60_000,
    // These are filtered searches; absence never proves a job has closed.
    exhaustiveInventory: false,
    feedWasComplete: () => report.complete, feedReport: () => report,
    async fetchEarlyCareer(signal) {
      report = { complete: false, pagesRead: 0, stopReason: 'started' };
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>();
      const now = opts.now ?? new Date();
      const apiKey = opts.apiKey ?? process.env.HIMALAYAS_API_KEY;
      const reasons: string[] = [];
      let requests = 0;
      for (const query of QUERIES) {
        const signatures = new Set<string>();
        let ended = false;
        for (let page = 1; page <= (opts.maxPages ?? 100); page++) {
          if (signal?.aborted) { report.stopReason = 'feed time limit reached'; return out; }
          if (requests++ > 0) {
            try {
              await new Promise<void>((resolve, reject) => {
                const stop = () => { clearTimeout(timer); reject(new Error('aborted')); };
                const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, opts.requestDelayMs ?? 1100);
                signal?.addEventListener('abort', stop, { once: true });
                if (signal?.aborted) stop();
              });
            } catch { report.stopReason = 'feed time limit reached'; return out; }
          }
          const params = new URLSearchParams({ ...query, sort: 'recent', page: String(page) });
          const url = `${ORIGIN}/jobs/api/search?${params}`;
          try {
            const response = await fetchImpl(url, {
              signal, headers: { Accept: 'application/json', 'User-Agent': 'Launchpad/0.1 (+https://github.com/mmakethingshaippen/launchpad)', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
            });
            const challenge = detectAccessChallenge(response.status, response.headers);
            if (challenge) {
              report.blocked = { status: response.status, vendor: challenge.vendor, evidence: challenge.evidence, host: 'himalayas.app' };
              report.stopReason = 'access challenge; stopped without retrying';
              return out;
            }
            // In particular, never hot-retry 429. Keep earlier pages and stop for this run.
            if (response.status === 429) { report.stopReason = 'rate limited (HTTP 429); retry on a later run'; return out; }
            const read = await readJsonResponse<{ jobs?: HimalayasJob[] }>(response, url);
            if (!read.ok) { report.stopReason = describeJsonFailure(read); return out; }
            if (!read.data || !Array.isArray(read.data.jobs)) { report.stopReason = 'unexpected response: no jobs array'; return out; }
            report.pagesRead++;
            const jobs = read.data.jobs;
            if (jobs.length === 0) { ended = true; break; }
            const signature = JSON.stringify(jobs.map(j => j?.guid ?? null));
            if (signatures.has(signature)) { report.stopReason = 'repeated page; pagination did not advance'; return out; }
            signatures.add(signature);
            for (const job of jobs) {
              if (!job || typeof job !== 'object') continue;
              const posting = normalize(job, now);
              if (!posting || seen.has(posting.externalJobId)) continue;
              seen.add(posting.externalJobId);
              out.push(posting);
            }
            // Do not stop at totalCount or on a short page: both can miss jobs.
          } catch {
            report.stopReason = signal?.aborted ? 'feed time limit reached' : 'request failed; earlier pages preserved';
            return out;
          }
        }
        if (!ended) { report.stopReason = 'page safety limit reached; coverage incomplete'; return out; }
        reasons.push(`${Object.values(query)[0]} search fully read`);
      }
      report.complete = true;
      report.stopReason = `${reasons.join('; ')}; ${out.length} eligible jobs`;
      return out;
    },
  };
}

/** Verify jobs missed by a filtered search using the documented per-job API. */
export async function checkHimalayasJob(
  role: { applyUrl: string; sourceUrl?: string | null; title: string; companyName: string | null }, fetchImpl: typeof fetch, now: Date,
): Promise<{ kind: 'live' | 'closed' | 'failed' | 'blocked' | 'unreadable'; reason: string }> {
  const guid = himalayasJobUrl(role.sourceUrl) ?? himalayasJobUrl(role.applyUrl);
  if (!guid) return { kind: 'unreadable', reason: 'invalid-himalayas-job-url' };
  const url = `${ORIGIN}/jobs/api${new URL(guid).pathname}`;
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', ...(process.env.HIMALAYAS_API_KEY ? { Authorization: `Bearer ${process.env.HIMALAYAS_API_KEY}` } : {}) }, signal: AbortSignal.timeout(15_000) });
  const challenge = detectAccessChallenge(response.status, response.headers);
  if (challenge) return { kind: 'blocked', reason: `blocked:${challenge.vendor}-challenge` };
  // A redirect's status is not evidence about the original API job.
  if (response.redirected) return { kind: 'unreadable', reason: 'himalayas-api-redirect' };
  if (response.status === 410) return { kind: 'closed', reason: 'himalayas-api-closed' };
  if (response.status === 404) return { kind: 'unreadable', reason: 'himalayas-api-job-not-found' };
  if (response.status === 429) return { kind: 'failed', reason: 'http-429' };
  const read = await readJsonResponse<{ job?: HimalayasJob }>(response, url);
  if (!read.ok) return { kind: read.kind === 'access-challenge' ? 'blocked' : 'failed', reason: read.kind === 'access-challenge' ? read.reason : describeJsonFailure(read) };
  const job = read.data?.job;
  if (!job || himalayasJobUrl(job.guid) !== guid || !job.title || !titleMatches(role.title, job.title) ||
      (role.companyName && (!job.companyName || normalizeText(role.companyName) !== normalizeText(job.companyName)))) {
    return { kind: 'unreadable', reason: 'himalayas-job-identity-mismatch' };
  }
  const expiry = seconds(job.expiryDate);
  if (expiry === null) return { kind: 'unreadable', reason: 'himalayas-expiry-missing' };
  return expiry <= now.getTime() ? { kind: 'closed', reason: 'himalayas-job-expired' } : { kind: 'live', reason: 'himalayas-api-job-match' };
}
