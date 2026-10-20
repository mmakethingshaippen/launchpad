import { describe, it, expect } from 'vitest';
import { normalizeApplyUrl } from './util';

describe('normalizeApplyUrl', () => {
  it('strips utm_* and other tracking params', () => {
    const a = normalizeApplyUrl('https://jobs.example.com/apply/123?utm_source=li&utm_medium=x&gh_src=abc');
    const b = normalizeApplyUrl('https://jobs.example.com/apply/123');
    expect(a).toBe(b);
  });

  it('keeps meaningful query params but sorts them', () => {
    const a = normalizeApplyUrl('https://x.com/j?b=2&a=1&utm_campaign=z');
    expect(a).toBe('https://x.com/j?a=1&b=2');
  });

  it('lowercases host, drops hash and trailing slash', () => {
    expect(normalizeApplyUrl('https://Jobs.EXAMPLE.com/apply/123/#top')).toBe(
      'https://jobs.example.com/apply/123',
    );
  });

  it('treats tracking-only differences as duplicates', () => {
    const x = normalizeApplyUrl('https://boards.greenhouse.io/acme/jobs/5?gh_jid=5&utm_source=launchpad');
    const y = normalizeApplyUrl('https://boards.greenhouse.io/acme/jobs/5?gh_jid=5');
    expect(x).toBe(y);
  });

  it('returns the input unchanged when it is not a URL', () => {
    expect(normalizeApplyUrl('not a url')).toBe('not a url');
    expect(normalizeApplyUrl('')).toBe('');
  });
});
