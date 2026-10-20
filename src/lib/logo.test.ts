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
  it('derives a favicon URL from the website domain', () => {
    const url = logoForCompany({ websiteUrl: 'https://www.stripe.com' });
    expect(url).toContain('favicons');
    expect(url).toContain('domain=stripe.com');
  });
  it('returns null when neither logo nor website is available', () => {
    expect(logoForCompany({})).toBeNull();
  });
});
