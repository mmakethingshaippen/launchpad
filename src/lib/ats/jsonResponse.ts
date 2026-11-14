/**
 * Server-side only. Validate an API response before parsing it as JSON.
 *
 * A 200 is not proof of a usable answer: Workday redirects a tenant under
 * maintenance to an HTML page (Target, Nov 2026: the job-list POST ended on
 * community.workday.com/maintenance-page with 200 text/html). Parsing that as
 * JSON produced "Unexpected token '<'". Callers get a classified failure
 * instead, and must treat every failure as "learned nothing": no verification
 * date refreshed, nothing closed.
 *
 * Reasons are short and log-safe. Response bodies are never included.
 */
import { TRANSIENT_HTTP } from './fetchRetry';
import { blockedReason, detectAccessChallenge, type HeaderSource } from './accessChallenge';

export type JsonFailureKind =
  /** Explicit bot/access challenge. Back off; never retry immediately. */
  | 'access-challenge'
  /** 408/429/5xx/52x after retries. Try again on a later run. */
  | 'transient'
  /** Redirected to a maintenance or "unavailable" page. Temporary; try again on a later run. */
  | 'maintenance'
  /** HTML (or another non-JSON type) where JSON was expected, without maintenance evidence. */
  | 'unexpected-html'
  /** 404/410/422 from the API itself: the configured board, tenant or site may be wrong. */
  | 'incorrect-endpoint'
  /** Declared JSON but did not parse. */
  | 'invalid-json'
  /** Any other non-2xx status. */
  | 'http-error';

export type JsonRead<T> =
  | { ok: true; data: T }
  | { ok: false; kind: JsonFailureKind; status: number; reason: string };

type ResponseLike = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
  url?: string;
  headers?: HeaderSource;
};

const MAINTENANCE_RE = /maintenance|unavailable|outage|downtime/i;
const PEEK_CHARS = 20_000;

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function titleOf(html: string): string {
  return ((/<title[^>]*>([^<]{0,120})/i.exec(html) ?? [])[1] ?? '').trim();
}

export async function readJsonResponse<T = unknown>(res: ResponseLike, requestedUrl: string): Promise<JsonRead<T>> {
  const status = res.status;
  const contentType = (res.headers?.get('content-type') ?? '').toLowerCase();
  const finalUrl = res.url || requestedUrl;
  const redirected = Boolean(res.url) && hostAndPath(finalUrl) !== hostAndPath(requestedUrl);
  const where = redirected ? ` (redirected to ${hostAndPath(finalUrl).slice(0, 120)})` : '';

  // Only a small prefix is read, and only to recognise challenge or maintenance pages.
  const peek = async () => (res.text ? (await res.text().catch(() => '')).slice(0, PEEK_CHARS) : '');

  if (!res.ok) {
    const body = status === 403 || status === 429 || status === 503 ? await peek() : '';
    const challenge = detectAccessChallenge(status, res.headers, body);
    if (challenge) return { ok: false, kind: 'access-challenge', status, reason: blockedReason(challenge) };
    if (TRANSIENT_HTTP.has(status)) return { ok: false, kind: 'transient', status, reason: `http-${status}${where}` };
    if (status === 404 || status === 410 || status === 422) {
      return { ok: false, kind: 'incorrect-endpoint', status, reason: `http-${status}${where}` };
    }
    return { ok: false, kind: 'http-error', status, reason: `http-${status}${where}` };
  }

  const challenge = detectAccessChallenge(status, res.headers);
  if (challenge) return { ok: false, kind: 'access-challenge', status, reason: blockedReason(challenge) };

  // A declared non-JSON type is never parsed. Without headers (test fakes) fall through to parsing.
  if (contentType && !contentType.includes('json')) {
    const body = await peek();
    const title = titleOf(body);
    if (MAINTENANCE_RE.test(finalUrl) || MAINTENANCE_RE.test(title)) {
      return { ok: false, kind: 'maintenance', status, reason: `maintenance${where}` };
    }
    return { ok: false, kind: 'unexpected-html', status, reason: `unexpected ${contentType.split(';')[0] || 'content'}${where}` };
  }

  if (res.text) {
    const text = await res.text().catch(() => null);
    if (text === null) return { ok: false, kind: 'invalid-json', status, reason: 'unreadable body' };
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      const looksHtml = /^\s*</.test(text);
      if (looksHtml && (MAINTENANCE_RE.test(finalUrl) || MAINTENANCE_RE.test(titleOf(text.slice(0, PEEK_CHARS))))) {
        return { ok: false, kind: 'maintenance', status, reason: `maintenance${where}` };
      }
      return looksHtml
        ? { ok: false, kind: 'unexpected-html', status, reason: `unexpected html${where}` }
        : { ok: false, kind: 'invalid-json', status, reason: `invalid json${where}` };
    }
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, kind: 'invalid-json', status, reason: `invalid json${where}` };
  }
}

/** One-line description for errors and logs. */
export function describeJsonFailure(failure: { kind: JsonFailureKind; reason: string }): string {
  return `${failure.kind}: ${failure.reason}`;
}