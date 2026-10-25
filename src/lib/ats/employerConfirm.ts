import type { FetchLike } from './types';

export type EmployerProvider = 'greenhouse' | 'lever' | 'ashby';

export interface EmployerTarget {
  provider: EmployerProvider;
  token: string;
  jobId: string;
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

export interface EmployerConfirmPlan {
  closeIds: string[];
  confirmIds: string[];
  skipped: number;
  boardsChecked: number;
  boardsFailed: number;
}

const FETCH_TIMEOUT_MS = 20_000;

function companyToken(company: EmployerCompany | null | undefined, provider: EmployerProvider): string {
  if (!company?.atsBoardToken) return '';
  return company.atsProvider === provider ? company.atsBoardToken.trim() : '';
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
  const parts = url.pathname.split('/').filter(Boolean);

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

  if (host === 'jobs.lever.co' && parts.length >= 2 && /^[0-9a-f-]{10,}$/i.test(parts[1])) {
    return { provider: 'lever', token: parts[0], jobId: parts[1] };
  }

  if (host === 'jobs.ashbyhq.com' && parts.length >= 2 && parts[1] !== 'jobs') {
    return { provider: 'ashby', token: parts[0], jobId: parts[1] };
  }

  return null;
}

async function readJson(res: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Open job ids for one board. Null means the board could not be read, so nothing from it may be closed. */
export async function fetchOpenJobIds(
  target: EmployerTarget,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  const token = encodeURIComponent(target.token);
  const url = target.provider === 'greenhouse'
    ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=false`
    : target.provider === 'lever'
      ? `https://api.lever.co/v0/postings/${token}?mode=json`
      : `https://api.ashbyhq.com/posting-api/job-board/${token}`;

  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await readJson(res);
  if (!data || typeof data !== 'object') return null;

  if (target.provider === 'lever') {
    if (!Array.isArray(data)) return null;
    return new Set(data.map((job) => String((job as { id?: string }).id ?? '')).filter(Boolean));
  }

  const jobs = (data as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return null;
  return new Set(jobs.map((job) => String((job as { id?: string | number }).id ?? '')).filter(Boolean));
}

export async function planEmployerConfirmation(
  roles: ConfirmableRole[],
  fetchImpl: FetchLike = fetch,
): Promise<EmployerConfirmPlan> {
  const closeIds: string[] = [];
  const confirmIds: string[] = [];
  let skipped = 0;
  const groups = new Map<string, { target: EmployerTarget; roles: Array<{ id: string; jobId: string }> }>();

  for (const role of roles) {
    if (!role.applyUrl) {
      skipped++;
      continue;
    }
    const target = identifyEmployerJob(role.applyUrl, role.company);
    if (!target) {
      skipped++;
      continue;
    }
    const key = `${target.provider}:${target.token.toLowerCase()}`;
    const group = groups.get(key) ?? { target, roles: [] };
    group.roles.push({ id: role.id, jobId: target.jobId });
    groups.set(key, group);
  }

  let boardsFailed = 0;
  const entries = [...groups.values()];
  const openByBoard = new Map<string, Set<string> | null>();
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      const key = `${entry.target.provider}:${entry.target.token.toLowerCase()}`;
      const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const open = await fetchOpenJobIds(entry.target, fetchImpl, signal);
      openByBoard.set(key, open);
    }
  }));

  for (const entry of entries) {
    const key = `${entry.target.provider}:${entry.target.token.toLowerCase()}`;
    const open = openByBoard.get(key);
    if (!open) {
      boardsFailed++;
      skipped += entry.roles.length;
      continue;
    }
    for (const role of entry.roles) {
      if (open.has(role.jobId)) confirmIds.push(role.id);
      else closeIds.push(role.id);
    }
  }

  return {
    closeIds,
    confirmIds,
    skipped,
    boardsChecked: entries.length - boardsFailed,
    boardsFailed,
  };
}
