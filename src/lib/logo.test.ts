import { describe, it, expect } from 'vitest';
import { domainFromUrl, logoForCompany } from './logo';

describe('domainFromUrl', () => {
  it('extracts the bare host, stripping www', () => {
    expect(domainFromUrl('https://www.stripe.com')).toBe('stripe.com');
    expect(domainFromUrl('http://notion.so/careers')).toBe('notion.so');
    expect(domainFromUrl('ramp.com')).toBe('ramp.com');
  });
  it('returns null for empty/invalid input', () => {
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl('not a url')).toBeNull();
  });
});

describe('logoForCompany', () => {
  it('prefers an explicit logo_url', () => {
    expect(logoForCompany({ logoUrl: 'https://cdn/x.png', websiteUrl: 'https://stripe.com' })).toBe(
      'https://cdn/x.png',
    );
  });
  it('derives a real-logo favicon URL from the website domain', () => {
    const url = logoForCompany({ websiteUrl: 'https://www.stripe.com' });
    expect(url).toContain('icon.horse/icon/stripe.com');
  });
  it('resolves a logo for domains Google serves a blank placeholder for (e.g. Anduril)', () => {
    const url = logoForCompany({ websiteUrl: 'https://www.anduril.com' });
    expect(url).toBe('https://icon.horse/icon/anduril.com');
  });
  it('returns null when neither logo nor website is available', () => {
    expect(logoForCompany({})).toBeNull();
  });
});
