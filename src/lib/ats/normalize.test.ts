import { describe, it, expect } from 'vitest';
import { selectCandidates, isDeadlinePassed } from './normalize';
import type { NormalizedPosting } from './types';

const NOW = new Date(Date.UTC(2026, 9, 1)); // Oct 1 2026

function posting(partial: Partial<NormalizedPosting> & { title: string }): NormalizedPosting {
  return {
    externalJobId: Math.random().toString(36).slice(2),
    descriptionHtml: '',
    applyUrl: 'https://example.com/apply',
    ...partial,
  };
}

describe('isDeadlinePassed (Req 7.1)', () => {
  it('is true only for a past date', () => {
    expect(isDeadlinePassed('2026-09-30', NOW)).toBe(true);
    expect(isDeadlinePassed('2026-10-01', NOW)).toBe(false); // today is allowed
    expect(isDeadlinePassed('2027-01-15', NOW)).toBe(false);
  });
  it('ignores absent / malformed deadlines', () => {
    expect(isDeadlinePassed(undefined, NOW)).toBe(false);
    expect(isDeadlinePassed('', NOW)).toBe(false);
    expect(isDeadlinePassed('not-a-date', NOW)).toBe(false);
  });
});

describe('selectCandidates — deadline, expired-term, fellowship', () => {
  it('rejects a role whose explicit deadline has passed', () => {
    const out = selectCandidates(
      [posting({ title: 'Software Engineering Intern', deadline: '2026-09-01' })],
      NOW,
    );
    expect(out).toHaveLength(0);
  });

  it('keeps a role whose deadline is in the future', () => {
    const out = selectCandidates(
      [posting({ title: 'Software Engineering Intern', deadline: '2027-02-01' })],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0].deadline).toBe('2027-02-01');
  });

  it('rejects an expired past-term title but keeps a future-term one', () => {
    const out = selectCandidates(
      [
        posting({ title: 'Summer 2026 Internship' }), // expired (cutoff Aug 31 2026)
        posting({ title: 'Summer 2027 Internship' }), // future
      ],
      NOW,
    );
    expect(out.map((o) => o.title)).toEqual(['Summer 2027 Internship']);
  });

  it('captures Anthropic-style fellowship roles with a valid future deadline', () => {
    const out = selectCandidates(
      [
        posting({ title: 'AI Research Fellowship', deadline: '2027-01-15' }),
        posting({ title: 'Engineering Fellowship', deadline: '2026-09-30' }), // expired
      ],
      NOW,
    );
    expect(out.map((o) => o.title)).toEqual(['AI Research Fellowship']);
    // A fellowship classifies as an internship-type early-career opportunity.
    expect(out[0].opportunityType).toBe('Internship');
  });
});
