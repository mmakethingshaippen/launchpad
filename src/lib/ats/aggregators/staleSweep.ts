import type { SupabaseClient } from '@supabase/supabase-js';
import { isValidHttpUrl } from '../util';

/**
 * Server-side only. Aggregator roles that no feed observed recently have no
 * other freshness signal, so each one gets a single look at its own apply page.
 *
 * Closing needs an explicit 404 or 410. Everything else that is not clearly a
 * live job page leaves the row exactly as it was. Absence alone never closes.
 */
// The workflow runs daily; check missed feed listings after 24 hours.
export const STALE_AFTER_DAYS = 1;
const READ_PAGE = 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 600_000;
const MIN_LIVE_BODY_CHARS = 500;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_BUDGET_MS = 25 * 60 * 1000;

/** A 200 page that says the job is gone is a soft 404. Do not stamp it; do not close from it either. */
const CLOSED_PAGE_RE =
  /no longer (available|accepting|open)|(job|position|posting|role) (has been|was|is) (filled|closed|removed|expired)|this (job|position|posting|role) (is )?(closed|expired|unavailable)|(job|position|page) (not found|could not be found)|no longer exists/i;

export interface StaleSweepResult {
  checked: number;
  refreshed: number;
  closed: number;
  unread: number;
  /** Stale rows not reached before the time budget ended. Counted in unread too. */
  skippedForTime: number;
}

type StaleRole = { id: string; title: string; applyUrl: string };

export type PageVerdict = 'closed' | 'live' | 'unread';

/** Decide from one response. Exported for tests. */
export function judgePage(status: number, contentType: string, body: string, title: string): PageVerdict {
  if (status === 404 || status === 410) return 'closed';
  if (status < 200 || status >= 300) return 'unread';
  if (!/html|json|xml/i.test(contentType)) return 'unread';
  if (body.length < MIN_LIVE_BODY_CHARS) return 'unread';
  if (CLOSED_PAGE_RE.test(body)) return 'unread';
  const hasJobPostingData = /"@type"\s*:\s*"JobPosting"/i.test(body);
  const normalizedBody = body.replace(/\s+/g, ' ').toLowerCase();
  const hasTitle = Boolean(title) && normalizedBody.includes(title.trim().replace(/\s+/g, ' ').toLowerCase());
  return hasJobPostingData || hasTitle ? 'live' : 'unread';
}

async function loadStaleRoles(db: SupabaseClient, cutoff: string): Promise<StaleRole[]> {
  const out: StaleRole[] = [];
  let after = '';
  for (;;) {
    let query = db.from('roles')
      .select('id,title,apply_url')
      .eq('source', 'aggregator')
      .eq('listing_status', 'Active')
      .lt('last_verified_at', cutoff)
      .order('id', { ascending: true })
      .limit(READ_PAGE);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) throw new Error(`Cannot load stale aggregator roles: ${error.message}`);
    const page = (data ?? []) as Array<{ id: string; title: string | null; apply_url: string | null }>;
    for (const row of page) {
      out.push({ id: String(row.id), title: row.title ?? '', applyUrl: row.apply_url ?? '' });
    }
    if (page.length === 0) break;
    after = String(page[page.length - 1].id);
    if (page.length < READ_PAGE) break;
  }
  return out;
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export async function sweepStaleAggregatorRoles(
  db: SupabaseClient,
  opts: {
    fetchImpl?: typeof fetch;
    now?: Date;
    concurrency?: number;
    budgetMs?: number;
    log?: (message: string) => void;
  } = {},
): Promise<StaleSweepResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => undefined);
  const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);

  // Random order so a time cut-off or a pile of unreadable pages cannot starve the same rows daily.
  const stale = shuffle(await loadStaleRoles(db, cutoff));
  log(`Stale aggregator roles (Active, last verified before ${cutoff}): ${stale.length}`);

  const result: StaleSweepResult = { checked: 0, refreshed: 0, closed: 0, unread: 0, skippedForTime: 0 };
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY) }, async () => {
    for (;;) {
      const item = stale[cursor++];
      if (!item) return;
      if (Date.now() > deadline) {
        result.skippedForTime += 1;
        result.unread += 1;
        continue;
      }
      result.checked += 1;
      if (!isValidHttpUrl(item.applyUrl)) {
        result.unread += 1;
        continue;
      }
      try {
        const response = await fetchImpl(item.applyUrl, {
          headers: { Accept: 'text/html,application/xhtml+xml,application/json' },
          redirect: 'follow',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        let body = '';
        if (response.status >= 200 && response.status < 300) {
          body = (await response.text()).slice(0, MAX_BODY_CHARS);
        }
        const verdict = judgePage(response.status, response.headers.get('content-type') ?? '', body, item.title);
        if (verdict === 'closed') {
          const { error } = await db.from('roles')
            .update({ listing_status: 'Closed' })
            .eq('id', item.id)
            .eq('source', 'aggregator')
            .eq('listing_status', 'Active');
          if (error) {
            result.unread += 1;
            log(`ERROR stale close ${item.id}: ${error.message}`);
          } else {
            result.closed += 1;
          }
        } else if (verdict === 'live') {
          const { error } = await db.from('roles')
            .update({ last_verified_at: new Date().toISOString() })
            .eq('id', item.id)
            .eq('source', 'aggregator')
            .eq('listing_status', 'Active');
          if (error) {
            result.unread += 1;
            log(`ERROR stale stamp ${item.id}: ${error.message}`);
          } else {
            result.refreshed += 1;
          }
        } else {
          result.unread += 1;
        }
      } catch {
        result.unread += 1;
      }
    }
  });
  await Promise.all(workers);

  log(
    `Stale aggregator sweep: refreshed ${result.refreshed}; closed ${result.closed}; ` +
    `still unread ${result.unread}` +
    (result.skippedForTime ? ` (${result.skippedForTime} not reached before the time budget)` : ''),
  );
  return result;
}
