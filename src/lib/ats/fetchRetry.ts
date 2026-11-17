import type { FetchLike } from './types';
import { detectAccessChallenge } from './accessChallenge';

/**
 * Statuses that usually clear on a second try. A 400 or 404 is a real answer.
 * 520-524 are Cloudflare edge errors meaning the origin was unreachable or slow
 * (Workday boards for HP, Mastercard and Autodesk returned 521 in production and
 * 200 when re-checked). They say nothing about whether a job exists.
 */
export const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

const DELAYS_MS = process.env.VITEST ? [10, 10, 10] : [1000, 2000, 4000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PageResponse = Awaited<ReturnType<FetchLike>>;

/**
 * Retry a page when the site blips. The caller decides whether a still-failing
 * page should be skipped so the rest of the board can be read.
 */
export async function fetchRetrying(
  fetchImpl: FetchLike,
  input: string,
  init: Parameters<FetchLike>[1],
  label: string,
): Promise<PageResponse> {
  let last: PageResponse | null = null;
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    if (init?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }
    try {
      const res = await fetchImpl(input, init);
      // A challenge can use 429/503. Repeating it is not a transient-error retry.
      // Return the response untouched so the caller can classify and back off.
      if (detectAccessChallenge(res.status, res.headers)) return res;
      if (res.ok || !TRANSIENT_HTTP.has(res.status) || attempt === DELAYS_MS.length) return res;
      last = res;
      console.log(`${label}: HTTP ${res.status}; retrying`);
    } catch (error) {
      if (init?.signal?.aborted || attempt === DELAYS_MS.length) throw error;
      console.log(`${label}: network error; retrying`);
    }
    await wait(DELAYS_MS[attempt]);
  }
  return last ?? { ok: false, status: 0, json: async () => ({}) };
}
