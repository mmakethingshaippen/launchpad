import type { FetchLike, ProviderClient, ProviderCoverage } from '../types';
import { fetchRetrying } from '../fetchRetry';
import { describeJsonFailure, readJsonResponse } from '../jsonResponse';
import { mapWorkArrangement, splitLocation } from '../util';

const BOARDS: Record<string, { name: string; origin: string; domain: string; searches: string[][] }> = {
  'micron.wd1.myworkdayjobs.com|micron|external': { name: 'Micron', origin: 'https://careers.micron.com', domain: 'micron.com', searches: [['0'], ['1']] },
  'hp.wd5.myworkdayjobs.com|hp|externalcareersite': { name: 'HP', origin: 'https://apply.hp.com', domain: 'hp.com', searches: [['internship', 'graduate']] },
};

async function pace(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (process.env.VITEST) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Aborted')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 1100);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

interface CareersPosition {
  id: number;
  atsJobId: string;
  name: string;
  locations?: string[] | null;
  workLocationOption?: string | null;
}

/** Restrict routing to employers whose official careers feeds were verified. */
export function hasOfficialCareersFeed(token: string): boolean {
  return Object.hasOwn(BOARDS, token.toLowerCase());
}

function isPosition(value: unknown): value is CareersPosition {
  if (!value || typeof value !== 'object') return false;
  const p = value as CareersPosition;
  return Number.isSafeInteger(p.id) && p.id > 0 &&
    typeof p.atsJobId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(p.atsJobId) &&
    typeof p.name === 'string' && Boolean(p.name.trim()) &&
    (p.locations == null || (Array.isArray(p.locations) && p.locations.every(l => typeof l === 'string'))) &&
    (p.workLocationOption == null || typeof p.workLocationOption === 'string');
}

/**
 * These employers publish Workday requisitions on official Eightfold careers
 * sites. Read their public search APIs without changing requisition IDs.
 * Presence confirms a job; absence here cannot close a legacy Workday listing.
 */
export function createOfficialCareersClient(token: string, fetchImpl: FetchLike = fetch): ProviderClient<CareersPosition> {
  if (!hasOfficialCareersFeed(token)) throw new Error('Unsupported official careers board');
  const board = BOARDS[token.toLowerCase()];
  const host = new URL(board.origin).hostname;
  let coverage: ProviderCoverage = { status: 'partial', reason: 'Not downloaded', host };
  return {
    provider: 'workday',
    isCompleteSnapshot: () => false,
    getFetchCoverage: () => coverage,
    async fetchPostings(requestedToken, signal) {
      if (requestedToken.toLowerCase() !== token.toLowerCase()) throw new Error('Official careers: employer token mismatch');
      coverage = { status: 'partial', reason: 'Download not finished', host };
      const positions: CareersPosition[] = [];
      const saved = new Set<number>();
      const observed = () => [...new Map(positions.map(position => [position.atsJobId, position])).values()];
      let requested = false;
      const incomplete: string[] = [];
      try {
        // Prioritize internships within short admin-worker deadlines, then read
        // other early-career searches. Never treat this as an unfiltered board.
        for (const seniority of board.searches) {
          const label = seniority.join('/');
          const seen = new Set<number>();
          let expected: number | undefined;
          let countChanged = false;
          let offset = 0;
          let ended = false;
          // The public careers UI uses start offsets and ten positions per page.
          // Always request the terminal empty page; never assume a short page is final.
          for (let page = 0; page < 500; page++) {
            // Use the site's "Latest" sort. The default company-priority order
            // can reshuffle tied results between requests and miss requisitions.
            if (requested) await pace(signal);
            requested = true;
            const params = new URLSearchParams({ domain: board.domain, query: '', sort_by: 'timestamp', start: String(offset) });
            for (const value of seniority) params.append('filter_seniority', value);
            const url = `${board.origin}/api/pcsx/search?${params}`;
            const response = await fetchRetrying(fetchImpl, url, { signal }, `${board.name} careers`);
            const parsed = await readJsonResponse<{ status?: number; data?: { count?: number; positions?: unknown[] } }>(response, url);
            if (!parsed.ok) {
              coverage.status = parsed.kind === 'access-challenge' ? 'blocked' : 'partial';
              throw new Error(describeJsonFailure(parsed));
            }
            const data = parsed.data?.data;
            if (parsed.data?.status !== 200 || !data || !Number.isSafeInteger(data.count) || data.count! < 0 ||
                !Array.isArray(data.positions) || !data.positions.every(isPosition)) {
              throw new Error('Invalid careers search response');
            }
            if (expected !== undefined && expected !== data.count) countChanged = true;
            expected = data.count!;
            if (!data.positions.length) {
              if (seen.size !== expected) incomplete.push(`${label}: search ended before the advertised job count`);
              if (countChanged) incomplete.push(`${label}: board count changed during pagination`);
              ended = true;
              break;
            }
            // The upstream API can overlap page boundaries, even using Latest.
            // Advance by the page length, not by the number of unique jobs saved.
            const before = seen.size;
            for (const position of data.positions) {
              seen.add(position.id);
              if (saved.has(position.id)) continue;
              saved.add(position.id);
              positions.push(position);
            }
            if (seen.size === before) throw new Error('Repeated positions during pagination');
            offset += data.positions.length;
          }
          if (!ended) throw new Error('Search page limit reached');
        }
        coverage = {
          status: incomplete.length ? 'partial' : 'filtered', host,
          reason: incomplete.length ? `${board.name} careers: ${incomplete.join('; ')}` :
            `Official ${board.name} careers: completed ${board.searches.length} early-career searches; absent legacy Workday jobs require separate verification`,
        };
        return observed();
      } catch (error) {
        coverage.reason = `${board.name} careers: ${error instanceof Error ? error.message : String(error)}`;
        if (!positions.length) throw new Error(coverage.reason);
        return observed();
      }
    },
    toNormalized(position) {
      if (!isPosition(position)) return null;
      return {
        externalJobId: position.atsJobId,
        title: position.name,
        descriptionHtml: '',
        applyUrl: `${board.origin}/careers/job/${position.id}`,
        ...splitLocation(position.locations?.[0]),
        workArrangement: mapWorkArrangement(position.workLocationOption),
      };
    },
  };
}
