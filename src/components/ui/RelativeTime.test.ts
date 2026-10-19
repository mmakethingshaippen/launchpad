import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './RelativeTime';

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-19T12:00:00Z').getTime();

  it('formats recent minutes/hours/days', () => {
    expect(formatRelativeTime('2026-10-19T11:58:00Z', now)).toBe('2m ago');
    expect(formatRelativeTime('2026-10-19T10:00:00Z', now)).toBe('2h ago');
    expect(formatRelativeTime('2026-10-17T12:00:00Z', now)).toBe('2d ago');
  });

  it('handles null/invalid', () => {
    expect(formatRelativeTime(null, now)).toBe('Not yet verified');
    expect(formatRelativeTime('nonsense', now)).toBe('Not yet verified');
  });
});
