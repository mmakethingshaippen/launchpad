/**
 * Pure, server-side judgement of one fetched job page. No network, no database.
 *
 * A page only counts as "live" when it carries evidence for THIS role:
 *   - a JobPosting JSON-LD object whose title (and employer, when both are
 *     known) match the stored role, or
 *   - when the page has no JobPosting data at all, an <h1> or <title> that is
 *     the role title.
 * An unrelated JobPosting, a recommended-jobs list, a search page, a login page
 * or a generic redirect target never counts.
 *
 * Closing needs an explicit 404/410 that can be attributed to the original URL.
 * Everything else leaves the row open and unverified.
 *
 * An explicit access challenge (see accessChallenge.ts) is reported as
 * 'blocked', separately from ordinary failures. A plain 403 stays 'failed'.
 */
import { blockedReason, detectAccessChallenge, type HeaderSource } from '../accessChallenge';

const MIN_LIVE_BODY_CHARS = 500;

/** A 200 page that says the job is gone is a soft 404. Do not stamp it; do not close from it either. */
const CLOSED_PAGE_RE =
  /no longer (available|accepting|open)|(job|position|posting|role) (has been|was|is) (filled|closed|removed|expired)|this (job|position|posting|role) (is )?(closed|expired|unavailable)|(job|position|page) (not found|could not be found)|no longer exists/i;

/**
 * live       evidence for this exact role
 * closed     explicit 404/410 on the original URL
 * unreadable the page was reached but cannot prove or disprove this role
 * failed     transport or server-side trouble; nothing was learned
 * blocked    the site served an explicit bot/access challenge; nothing was learned
 */
export type PageVerdictKind = 'closed' | 'live' | 'unreadable' | 'failed' | 'blocked';

export interface PageVerdict {
  verdict: PageVerdictKind;
  /** Short machine-friendly reason, stored on the row for unverified outcomes. */
  reason: string;
}

export interface PageEvidenceInput {
  status: number;
  contentType: string;
  body: string;
  role: { title: string; companyName?: string | null };
  requestedUrl: string;
  /** Final URL after redirects (Response.url). Empty or absent means "same as requested". */
  finalUrl?: string | null;
  /** Response headers, used only to recognise an explicit access challenge. */
  headers?: HeaderSource | null;
  now?: Date;
}

const GENERIC_LAST_SEGMENTS = new Set([
  'jobs', 'job', 'careers', 'career', 'search', 'login', 'log-in', 'signin', 'sign-in', 'signup', 'sign-up',
  'auth', 'sso', 'error', 'not-found', 'notfound', '404', 'home', 'index', 'opportunities', 'openings',
  'positions', 'results', 'job-search', 'open-positions', 'en', 'us',
]);
const AUTH_SEGMENTS = new Set(['login', 'log-in', 'signin', 'sign-in', 'sso', 'auth', 'oauth', 'authenticate', 'account']);

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function comparable(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  return `${host}${path}`;
}

/** True when the response ended on a different host or path than the one requested. */
export function redirectedElsewhere(requestedUrl: string, finalUrl: string | null | undefined): boolean {
  const requested = parseUrl(requestedUrl);
  const final = parseUrl(finalUrl);
  if (!requested || !final) return false;
  return comparable(requested) !== comparable(final);
}

/** Landing, search, listing and login destinations say nothing about one specific role. */
export function isGenericDestination(url: string | null | undefined): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const segments = parsed.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  if (segments.length === 0) return true;
  if (segments.some((s) => AUTH_SEGMENTS.has(s))) return true;
  if (GENERIC_LAST_SEGMENTS.has(segments[segments.length - 1])) return true;
  return false;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "Data Intern (Summer 2026)" is stored with its terms appended; pages show only "Data Intern". */
function roleTitleVariants(title: string): string[] {
  const full = normalizeText(title);
  const base = normalizeText(title.replace(/\s*\([^()]*\)\s*$/, ''));
  return [...new Set([full, base].filter(Boolean))];
}

/** Exact title match, allowing "Title - Company" / "Title | Company" page-title decoration. */
export function titleMatches(roleTitle: string, candidate: string): boolean {
  const variants = roleTitleVariants(roleTitle);
  if (!variants.length) return false;
  const parts = [candidate, ...candidate.split(/\s[-\u2013\u2014|@]\s|\sat\s/i)];
  return parts.some((part) => {
    const normalized = normalizeText(decodeEntities(part));
    return normalized.length > 0 && variants.includes(normalized);
  });
}

function organizationMatches(roleCompany: string | null | undefined, organization: unknown): boolean {
  const name = typeof organization === 'string'
    ? organization
    : organization && typeof organization === 'object' && typeof (organization as { name?: unknown }).name === 'string'
      ? (organization as { name: string }).name
      : '';
  // Nothing to compare on one side: the title match stands on its own.
  if (!name || !roleCompany) return true;
  const a = normalizeText(name);
  const b = normalizeText(roleCompany);
  if (!a || !b) return true;
  // "Amazon" vs "Amazon.com Services LLC" match; a shared first word ("The ...") does not.
  return a.includes(b) || b.includes(a);
}

type JsonObject = Record<string, unknown>;

function isJobPosting(value: JsonObject): boolean {
  const type = value['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
}

function collectJobPostings(node: unknown, out: JsonObject[], depth = 0): void {
  if (depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectJobPostings(item, out, depth + 1);
    return;
  }
  const obj = node as JsonObject;
  if (isJobPosting(obj)) out.push(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') collectJobPostings(value, out, depth + 1);
  }
}

function jsonLdPostings(html: string): JsonObject[] {
  const found: JsonObject[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    try {
      collectJobPostings(JSON.parse(match[1].trim()), found);
    } catch {
      // Malformed JSON-LD is not evidence of anything.
    }
  }
  return found;
}

function postingTitle(posting: JsonObject): string {
  for (const key of ['title', 'name']) {
    const value = posting[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function headings(html: string, tag: 'h1' | 'title'): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const text = stripTags(match[1]);
    if (text) out.push(text);
  }
  return out;
}

function evidenceForRole(
  body: string,
  contentType: string,
  role: PageEvidenceInput['role'],
  now: Date,
): PageVerdict {
  let postings: JsonObject[] = [];
  if (/json/i.test(contentType)) {
    try {
      collectJobPostings(JSON.parse(body), postings);
    } catch {
      return { verdict: 'unreadable', reason: 'invalid-json' };
    }
  } else {
    postings = jsonLdPostings(body);
  }

  if (postings.length > 0) {
    const matching = postings.filter((p) => titleMatches(role.title, postingTitle(p)));
    if (!matching.length) return { verdict: 'unreadable', reason: 'unrelated-jobposting' };
    const sameEmployer = matching.filter((p) => organizationMatches(role.companyName, p.hiringOrganization));
    if (!sameEmployer.length) return { verdict: 'unreadable', reason: 'jobposting-other-employer' };
    const open = sameEmployer.filter((p) => {
      const through = typeof p.validThrough === 'string' ? Date.parse(p.validThrough) : NaN;
      return !(Number.isFinite(through) && through < now.getTime());
    });
    if (!open.length) return { verdict: 'unreadable', reason: 'jobposting-expired' };
    return { verdict: 'live', reason: 'jobposting-match' };
  }

  if (/json/i.test(contentType)) return { verdict: 'unreadable', reason: 'no-role-evidence' };
  if (/<input\b[^>]*type\s*=\s*["']?password/i.test(body)) return { verdict: 'unreadable', reason: 'login-page' };

  const matched = [...headings(body, 'h1'), ...headings(body, 'title')].some((h) => titleMatches(role.title, h));
  return matched
    ? { verdict: 'live', reason: 'heading-match' }
    : { verdict: 'unreadable', reason: 'no-role-evidence' };
}

/** Decide from one response. Exported for tests. */
export function judgePage(input: PageEvidenceInput): PageVerdict {
  const { status, contentType, body, role, requestedUrl, finalUrl } = input;
  const redirected = redirectedElsewhere(requestedUrl, finalUrl);

  // Before any status rule: a challenge can arrive as 403, 429, 503 or even 200.
  const challenge = detectAccessChallenge(status, input.headers, body);
  if (challenge) return { verdict: 'blocked', reason: blockedReason(challenge) };

  if (status === 404 || status === 410) {
    // A 404 at a redirect target (often a generic page) says nothing about the original job.
    return redirected
      ? { verdict: 'unreadable', reason: `redirected-then-http-${status}` }
      : { verdict: 'closed', reason: `http-${status}` };
  }
  if (status === 403 || status === 408 || status === 429 || status >= 500) {
    return { verdict: 'failed', reason: `http-${status}` };
  }
  if (status < 200 || status >= 300) return { verdict: 'unreadable', reason: `http-${status}` };
  if (redirected && isGenericDestination(finalUrl)) return { verdict: 'unreadable', reason: 'generic-redirect' };
  if (!/html|json|xml/i.test(contentType)) return { verdict: 'unreadable', reason: 'unsupported-content-type' };
  if (body.length < MIN_LIVE_BODY_CHARS) return { verdict: 'unreadable', reason: 'body-too-short' };
  if (CLOSED_PAGE_RE.test(body)) return { verdict: 'unreadable', reason: 'page-says-closed' };
  return evidenceForRole(body, contentType, role, input.now ?? new Date());
}
