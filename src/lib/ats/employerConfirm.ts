import type { FetchLike } from './types';
import { fetchRetrying } from './fetchRetry';
import { describeJsonFailure, readJsonResponse } from './jsonResponse';

export type EmployerProvider = 'greenhouse' | 'lever' | 'ashby';

export interface EmployerTarget {
  provider: EmployerProvider;
  token: string;
  jobId: string;
  /** Lever hosts EU boards (jobs.eu.lever.co) on a separate API. */
  region?: 'eu';
}

export interface EmployerCompany {
  atsProvider?: string | null;
  atsBoardToken?: string | null;
}

export interface ConfirmableRole {
  id: string;
  applyUrl: string | null;
  company?: EmployerCompany | null;
}

export interface FailedBoard {
  provider: EmployerProvider;
  token: string;
  region?: 'eu';
  /** e.g. 'http-404', 'http-521', 'network-error', 'unexpected-response'. */
  reason: string;
  /** Jobs that could not be confirmed or closed because this board was unreadable. */
  roles: number;
}

export interface EmployerConfirmPlan {
  closeIds: string[];
  confirmIds: string[];
  /** skippedUnsupported + skippedBoardFailed. Kept for existing callers. */
  skipped: number;
  /** Expected: the apply URL is not a Greenhouse, Lever or Ashby job link (Workday, custom sites, aggregators). */
  skippedUnsupported: number;
  /** Jobs on boards that could not be read. Nothing on those boards is confirmed or closed. */
  skippedBoardFailed: number;
  /** Unsupported apply-URL hosts and how many jobs each has, largest first. */
  unsupportedHosts: Array<{ host: string; roles: number }>;
  boardsChecked: number;
  boardsFailed: number;
  failedBoards: FailedBoard[];
}

const FETCH_TIMEOUT_MS = 20_000;
const BOARD_CONCURRENCY = 4;

function companyToken(company: EmployerCompany | null | undefined, provider: EmployerProvider): string {
  if (!company?.atsBoardToken) return '';
  return company.atsProvider === provider ? company.atsBoardToken.trim() : '';
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Pull a board token and job id out of an apply URL. Custom domains can use the company's stored token. */
export function identifyEmployerJob(applyUrl: string, company?: EmployerCompany | null): EmployerTarget | null {
  let url: URL;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  // Path segments arrive percent-encoded (jobs.ashbyhq.com/skyband%20systems/...). Decode them once
  // here; boardUrl() encodes once. Keeping the encoded form made requests for skyband%2520systems.
  const parts = url.pathname.split('/').filter(Boolean).map(decodeSegment);

  // boards.greenhouse.io, job-boards.greenhouse.io and the regional job-boards.eu/anz
  // hosts are all served by boards-api.greenhouse.io (checked against live boards).
  if (host.endsWith('greenhouse.io')) {
    const jobsAt = parts.indexOf('jobs');
    const tokenFromPath = jobsAt > 0 ? parts[jobsAt - 1] : '';
    const idFromPath = jobsAt >= 0 ? parts[jobsAt + 1] ?? '' : '';
    const ghJid = url.searchParams.get('gh_jid') ?? '';
    const jobId = /^\d+$/.test(idFromPath) ? idFromPath : /^\d+$/.test(ghJid) ? ghJid : '';
    const token = tokenFromPath || companyToken(company, 'greenhouse');
    if (token && jobId) return { provider: 'greenhouse', token, jobId };
    return null;
  }

  const ghJid = url.searchParams.get('gh_jid') ?? '';
  if (/^\d+$/.test(ghJid)) {
    const token = companyToken(company, 'greenhouse');
    if (token) return { provider: 'greenhouse', token, jobId: ghJid };
    return null;
  }

  if ((host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') && parts.length >= 2 && /^[0-9a-f-]{10,}$/i.test(parts[1])) {
    return host === 'jobs.eu.lever.co'
      ? { provider: 'lever', token: parts[0], jobId: parts[1], region: 'eu' }
      : { provider: 'lever', token: parts[0], jobId: parts[1] };
  }

  if (host === 'jobs.ashbyhq.com' && parts.length >= 2 && parts[1] !== 'jobs') {
    return { provider: 'ashby', token: parts[0], jobId: parts[1] };
  }

  return null;
}

export function boardUrl(target: Pick<EmployerTarget, 'provider' | 'token' | 'region'>): string {
  const token = encodeURIComponent(target.token);
  if (target.provider === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`;
  if (target.provider === 'lever') {
    return `https://api${target.region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${token}?mode=json`;
  }
  return `https://api.ashbyhq.com/posting-api/job-board/${token}`;
}

function boardKey(target: Pick<EmployerTarget, 'provider' | 'token' | 'region'>): string {
  return `${target.provider}:${target.region ?? 'global'}:${target.token.toLowerCase()}`;
}

export type BoardRead = { open: Set<string>; reason?: undefined } | { open: null; reason: string };

/**
 * Open job ids for one board, with retries for transient failures. A null set
 * means the board could not be read, so nothing from it may be confirmed or closed.
 */
export async function readBoard(
  target: Pick<EmployerTarget, 'provider' | 'token' | 'region'>,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<BoardRead> {
  let res;
  try {
    res = await fetchRetrying(fetchImpl, boardUrl(target), { signal }, `${target.provider} board ${target.token}`);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { open: null, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network-error' };
  }
  // Validate before parsing: challenges, maintenance pages and other HTML are named, not parsed.
  const read = await readJsonResponse(res, boardUrl(target));
  if (!read.ok) return { open: null, reason: describeJsonFailure(read) };
  const data = read.data;
  if (!data || typeof data !== 'object') return { open: null, reason: 'unexpected-response' };

  if (target.provider === 'lever') {
    if (!Array.isArray(data)) return { open: null, reason: 'unexpected-response' };
    return { open: new Set(data.map((job) => String((job as { id?: string }).id ?? '')).filter(Boolean)) };
  }

  const jobs = (data as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return { open: null, reason: 'unexpected-response' };
  return { open: new Set(jobs.map((job) => String((job as { id?: string | number }).id ?? '')).filter(Boolean)) };
}

/** Kept for existing callers. */
export async function fetchOpenJobIds(
  target: EmployerTarget,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  return (await readBoard(target, fetchImpl, signal)).open;
}

function hostOf(applyUrl: string): string {
  try {
    return new URL(applyUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'invalid-url';
  }
}

export async function planEmployerConfirmation(
  roles: ConfirmableRole[],
  fetchImpl: FetchLike = fetch,
): Promise<EmployerConfirmPlan> {
  const closeIds: string[] = [];
  const confirmIds: string[] = [];
  let skippedUnsupported = 0;
  let skippedBoardFailed = 0;
  const unsupported = new Map<string, number>();
  const groups = new Map<string, { target: EmployerTarget; roles: Array<{ id: string; jobId: string }> }>();

  for (const role of roles) {
    const target = role.applyUrl ? identifyEmployerJob(role.applyUrl, role.company) : null;
    if (!target) {
      skippedUnsupported++;
      const host = role.applyUrl ? hostOf(role.applyUrl) : 'no-url';
      unsupported.set(host, (unsupported.get(host) ?? 0) + 1);
      continue;
    }
    const key = boardKey(target);
    const group = groups.get(key) ?? { target, roles: [] };
    group.roles.push({ id: role.id, jobId: target.jobId });
    groups.set(key, group);
  }

  const entries = [...groups.values()];
  const reads = new Map<string, BoardRead>();
  let cursor = 0;
  // One slow or failing board only occupies one worker; every other board is still read.
  await Promise.all(Array.from({ length: Math.min(BOARD_CONCURRENCY, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      reads.set(boardKey(entry.target), await readBoard(entry.target, fetchImpl, AbortSignal.timeout(FETCH_TIMEOUT_MS)));
    }
  }));

  const failedBoards: FailedBoard[] = [];
  for (const entry of entries) {
    const read = reads.get(boardKey(entry.target))!;
    if (!read.open) {
      skippedBoardFailed += entry.roles.length;
      failedBoards.push({
        provider: entry.target.provider,
        token: entry.target.token,
        ...(entry.target.region ? { region: entry.target.region } : {}),
        reason: read.reason,
        roles: entry.roles.length,
      });
      continue;
    }
    for (const role of entry.roles) {
      if (read.open.has(role.jobId)) confirmIds.push(role.id);
      else closeIds.push(role.id);
    }
  }

  failedBoards.sort((a, b) => b.roles - a.roles);
  return {
    closeIds,
    confirmIds,
    skipped: skippedUnsupported + skippedBoardFailed,
    skippedUnsupported,
    skippedBoardFailed,
    unsupportedHosts: [...unsupported.entries()].map(([host, n]) => ({ host, roles: n })).sort((a, b) => b.roles - a.roles),
    boardsChecked: entries.length - failedBoards.length,
    boardsFailed: failedBoards.length,
    failedBoards,
  };
}