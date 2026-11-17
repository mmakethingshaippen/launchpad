import type { FetchLike } from '../types';
import { fetchRetrying, TRANSIENT_HTTP } from '../fetchRetry';
import type { AggregatedPosting, AggregatorClient, FeedReport } from './types';
import { isEarlyCareerTitle } from '../classify';
import { splitLocation } from '../util';
import { detectAccessChallenge, type AccessChallenge, type HeaderSource } from '../accessChallenge';

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
/** Safety stop only. Paging ends earlier when The Muse reports its last page. */
const MAX_PAGES_PER_LEVEL = 100;

export function createTheMuseClient(fetchImpl: FetchLike = fetch): AggregatorClient {
  let feedComplete = false;
  let report: FeedReport = { complete: false, pagesRead: 0, stopReason: 'not fetched yet' };
  return {
    source: 'themuse',
    feedWasComplete: () => feedComplete,
    feedReport: () => report,
    async fetchEarlyCareer(signal) {
      feedComplete = false;
      let stoppedEarly = false;
      let pagesRead = 0;
      let blocked: { status: number; challenge: AccessChallenge } | null = null;
      const reasons: string[] = [];
      const stop = (level: string, page: number, reason: string, incomplete: boolean) => {
        reasons.push(`${level}: ${reason} at page ${page}`);
        if (incomplete) stoppedEarly = true;
      };
      const out: AggregatedPosting[] = [];
      const seen = new Set<string>(); // dedup across level/page queries
      for (const level of LEVELS) {
        if (blocked) {
          // Same host, same challenge: do not send more requests for the other level.
          stop(level, 1, 'not requested: access challenge on an earlier request', true);
          continue;
        }
        if (signal?.aborted) {
          stop(level, 1, 'not started: feed time limit reached', true);
          continue;
        }
        let previousFirstId: number | undefined;
        let skippedPages = 0;
        for (let page = 1; page <= MAX_PAGES_PER_LEVEL; page++) {
          const url = `https://www.themuse.com/api/public/jobs?level=${encodeURIComponent(level)}&page=${page}`;
          let res;
          try {
            res = await fetchRetrying(fetchImpl, url, { signal }, `The Muse ${level} page ${page}`);
          } catch {
            stoppedEarly = true;
            if (signal?.aborted) {
              // The caller's time limit, not a page error. Keep what was read and say so.
              stop(level, page, `feed time limit reached after ${pagesRead} page(s) read`, true);
              break;
            }
            skippedPages += 1;
            if (skippedPages >= 3) {
              stop(level, page, 'stopped after 3 skipped pages (network errors)', true);
              break;
            }
            reasons.push(`${level}: network error skipped page ${page}`);
            continue;
          }
          // Challenges can also be served with a 2xx status. Do not treat one
          // as malformed JSON and request up to 100 more pages from this host.
          const headerChallenge = detectAccessChallenge(res.status, res.headers);
          if (headerChallenge) {
            blocked = { status: res.status, challenge: headerChallenge };
            stop(level, page, `access challenge: ${headerChallenge.evidence}`, true);
            break;
          }
          if (!res.ok) {
            stoppedEarly = true;
            const withExtras = res as typeof res & { headers?: HeaderSource; text?: () => Promise<string> };
            const refusalBody = withExtras.text ? (await withExtras.text().catch(() => '')).slice(0, 20_000) : '';
            const challenge = detectAccessChallenge(res.status, withExtras.headers, refusalBody);
            if (challenge) {
              blocked = { status: res.status, challenge };
              stop(level, page, `access challenge: ${challenge.evidence}`, true);
              console.error(`The Muse: access challenge on ${level} page ${page}: ${challenge.evidence}`);
              break;
            }
            if (!TRANSIENT_HTTP.has(res.status) || skippedPages >= 2) {
              stop(level, page, `stopped on HTTP ${res.status}`, true);
              console.error(`The Muse: stopped on ${level} page ${page}: HTTP ${res.status}`);
              break;
            }
            skippedPages += 1;
            reasons.push(`${level}: HTTP ${res.status} skipped page ${page}`);
            console.error(`The Muse: HTTP ${res.status} on ${level} page ${page}; skipping that page`);
            continue;
          }
          let data: MuseResponse;
          try {
            data = (await res.json()) as MuseResponse;
            if (!data || !Array.isArray(data.results)) throw new Error('missing results array');
          } catch {
            stoppedEarly = true;
            skippedPages += 1;
            if (skippedPages >= 3) {
              stop(level, page, 'stopped after 3 skipped pages (unreadable JSON)', true);
              break;
            }
            reasons.push(`${level}: unreadable JSON skipped page ${page}`);
            continue;
          }
          // Reset only after usable JSON; resetting before parsing made the
          // three-failure stop unreachable on repeated HTML/invalid payloads.
          skippedPages = 0;
          pagesRead += 1;
          const results = data.results ?? [];
          if (results.length === 0) {
            stop(level, page, 'empty results page', false);
            break;
          }
          const firstId = results[0]?.id;
          if (firstId !== undefined && firstId === previousFirstId) {
            stop(level, page, 'repeated first id; pagination did not advance', true);
            break;
          }
          previousFirstId = firstId;

          for (const j of results) {
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
          const pageCount = data.page_count;
          if (typeof pageCount === 'number' && Number.isFinite(pageCount) && pageCount >= 1 && pageCount <= page) {
            stop(level, page, `last page (page_count ${pageCount})`, false);
            break;
          }
          if (page === MAX_PAGES_PER_LEVEL) {
            stop(level, page, 'safety cap reached; more results may remain', true);
            console.error(`The Muse: safety stop on ${level} at ${MAX_PAGES_PER_LEVEL} pages; more results may remain`);
            stoppedEarly = true;
          }
        }
      }
      feedComplete = !stoppedEarly;
      report = {
        complete: feedComplete,
        pagesRead,
        stopReason: reasons.join('; ') || 'no pages read',
        ...(blocked ? {
          blocked: { status: blocked.status, vendor: blocked.challenge.vendor, evidence: blocked.challenge.evidence, host: 'www.themuse.com' },
        } : {}),
      };
      return out;
    },
  };
}
