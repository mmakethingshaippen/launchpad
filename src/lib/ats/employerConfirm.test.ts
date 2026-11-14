import { describe, expect, it } from 'vitest';
import type { FetchLike } from './types';
import { identifyEmployerJob, planEmployerConfirmation } from './employerConfirm';

function boardFetch(boards: Record<string, { status?: number; body: unknown }>): FetchLike {
  return async (url) => {
    const key = String(url);
    const found = Object.entries(boards).find(([part]) => key.includes(part));
    const body = found?.[1].body ?? { jobs: [] };
    const status = found?.[1].status ?? (found ? 200 : 500);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

describe('identifyEmployerJob', () => {
  it('reads a Greenhouse board and job id from the hosted URL', () => {
    expect(identifyEmployerJob('https://boards.greenhouse.io/nuro/jobs/8248317')).toEqual({
      provider: 'greenhouse',
      token: 'nuro',
      jobId: '8248317',
    });
  });

  it('uses the company token for a custom domain that only has gh_jid', () => {
    expect(identifyEmployerJob('https://nuro.ai/careersitem?gh_jid=8248317', {
      atsProvider: 'greenhouse',
      atsBoardToken: 'nuro',
    })).toEqual({ provider: 'greenhouse', token: 'nuro', jobId: '8248317' });
  });

  it('does not guess a Greenhouse token when the company has none', () => {
    expect(identifyEmployerJob('https://nuro.ai/careersitem?gh_jid=8248317')).toBeNull();
  });

  it('reads Lever and Ashby tokens from the URL', () => {
    expect(identifyEmployerJob('https://jobs.lever.co/spotify/11111111-1111-1111-1111-111111111111')?.provider).toBe('lever');
    expect(identifyEmployerJob('https://jobs.ashbyhq.com/openai/22222222-2222-2222-2222-222222222222')?.token).toBe('openai');
  });
});

describe('planEmployerConfirmation', () => {
  it('closes a Greenhouse job missing from a board that loaded', async () => {
    const plan = await planEmployerConfirmation([
      { id: 'closed', applyUrl: 'https://boards.greenhouse.io/nuro/jobs/8248317' },
      { id: 'open', applyUrl: 'https://boards.greenhouse.io/nuro/jobs/100' },
    ], boardFetch({
      '/boards/nuro/': { body: { jobs: [{ id: 100 }] } },
    }));
    expect(plan.closeIds).toEqual(['closed']);
    expect(plan.confirmIds).toEqual(['open']);
    expect(plan.boardsFailed).toBe(0);
  });

  it('does not close jobs when the board request fails', async () => {
    const plan = await planEmployerConfirmation([
      { id: 'keep', applyUrl: 'https://jobs.lever.co/spotify/11111111-1111-1111-1111-111111111111' },
    ], boardFetch({
      '/postings/spotify': { status: 503, body: {} },
    }));
    expect(plan.closeIds).toEqual([]);
    expect(plan.confirmIds).toEqual([]);
    expect(plan.boardsFailed).toBe(1);
  });

  it('closes an Ashby job that is absent from the board list', async () => {
    const plan = await planEmployerConfirmation([
      { id: 'gone', applyUrl: 'https://jobs.ashbyhq.com/openai/missing-job' },
    ], boardFetch({
      '/job-board/openai': { body: { jobs: [{ id: 'other-job' }] } },
    }));
    expect(plan.closeIds).toEqual(['gone']);
  });
});

describe('employer board coverage fixes', () => {
  it('reads EU Lever boards from the EU API instead of skipping them', async () => {
    const target = identifyEmployerJob('https://jobs.eu.lever.co/cirrus/33333333-3333-3333-3333-333333333333');
    expect(target).toEqual({ provider: 'lever', token: 'cirrus', jobId: '33333333-3333-3333-3333-333333333333', region: 'eu' });
    const urls: string[] = [];
    const plan = await planEmployerConfirmation(
      [{ id: 'eu-open', applyUrl: 'https://jobs.eu.lever.co/cirrus/33333333-3333-3333-3333-333333333333' }],
      (async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => [{ id: '33333333-3333-3333-3333-333333333333' }] };
      }) as FetchLike,
    );
    expect(urls).toEqual(['https://api.eu.lever.co/v0/postings/cirrus?mode=json']);
    expect(plan.confirmIds).toEqual(['eu-open']);
    expect(plan.skippedUnsupported).toBe(0);
  });

  it('retries a transient Cloudflare 521 before giving up on a board', async () => {
    let calls = 0;
    const plan = await planEmployerConfirmation(
      [{ id: 'r1', applyUrl: 'https://boards.greenhouse.io/acme/jobs/100' }],
      (async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, status: 521, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({ jobs: [{ id: 100 }] }) };
      }) as FetchLike,
    );
    expect(calls).toBe(2);
    expect(plan).toMatchObject({ boardsFailed: 0, confirmIds: ['r1'], closeIds: [] });
  });

  it('separates unsupported URLs from jobs on unreadable boards and records why each board failed', async () => {
    const plan = await planEmployerConfirmation([
      { id: 'wd', applyUrl: 'https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS/job/X_R1' },
      { id: 'wd2', applyUrl: 'https://cvshealth.wd1.myworkdayjobs.com/en-US/CVS/job/X_R2' },
      { id: 'gone-board', applyUrl: 'https://boards.greenhouse.io/renamed/jobs/7' },
      { id: 'none', applyUrl: null },
    ], boardFetch({ '/boards/renamed/': { status: 404, body: {} } }));
    expect(plan).toMatchObject({
      skippedUnsupported: 3, skippedBoardFailed: 1, skipped: 4, boardsFailed: 1, closeIds: [], confirmIds: [],
    });
    expect(plan.failedBoards).toEqual([{ provider: 'greenhouse', token: 'renamed', reason: 'http-404', roles: 1 }]);
    expect(plan.unsupportedHosts[0]).toEqual({ host: 'cvshealth.wd1.myworkdayjobs.com', roles: 2 });
  });

  it('never closes from an unexpected response shape', async () => {
    const plan = await planEmployerConfirmation(
      [{ id: 'keep', applyUrl: 'https://jobs.ashbyhq.com/acme/44444444-4444-4444-4444-444444444444' }],
      boardFetch({ '/job-board/acme': { body: { message: 'maintenance' } } }),
    );
    expect(plan).toMatchObject({ closeIds: [], confirmIds: [], boardsFailed: 1 });
    expect(plan.failedBoards[0].reason).toBe('unexpected-response');
  });
});