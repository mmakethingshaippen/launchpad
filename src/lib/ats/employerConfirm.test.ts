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
