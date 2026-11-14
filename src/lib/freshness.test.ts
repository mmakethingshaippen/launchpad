// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { freshnessCutoff, isAwaitingVerification, isFreshlyVerified, VERIFICATION_FRESHNESS_DAYS } from './freshness';

const NOW = new Date('2026-11-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('seven-day verification freshness', () => {
  it('uses a seven-day window', () => {
    expect(VERIFICATION_FRESHNESS_DAYS).toBe(7);
    expect(freshnessCutoff(NOW).toISOString()).toBe(daysAgo(7));
  });

  it('keeps recently verified jobs visible, including exactly at the cutoff', () => {
    expect(isFreshlyVerified(daysAgo(0.01), NOW)).toBe(true);
    expect(isFreshlyVerified(daysAgo(6.9), NOW)).toBe(true);
    expect(isFreshlyVerified(daysAgo(7), NOW)).toBe(true);
  });

  it('hides jobs verified more than seven days ago and jobs never verified', () => {
    expect(isFreshlyVerified(daysAgo(7.01), NOW)).toBe(false);
    expect(isFreshlyVerified(daysAgo(30), NOW)).toBe(false);
    expect(isFreshlyVerified(null, NOW)).toBe(false);
    expect(isFreshlyVerified(undefined, NOW)).toBe(false);
    expect(isFreshlyVerified('not a date', NOW)).toBe(false);
  });

  it('treats only Active jobs as awaiting verification; closed jobs keep their closed handling', () => {
    expect(isAwaitingVerification({ listingStatus: 'Active', lastVerifiedAt: null }, NOW)).toBe(true);
    expect(isAwaitingVerification({ listingStatus: 'Active', lastVerifiedAt: daysAgo(10) }, NOW)).toBe(true);
    expect(isAwaitingVerification({ listingStatus: 'Active', lastVerifiedAt: daysAgo(1) }, NOW)).toBe(false);
    expect(isAwaitingVerification({ listingStatus: 'Closed', lastVerifiedAt: daysAgo(10) }, NOW)).toBe(false);
  });
});