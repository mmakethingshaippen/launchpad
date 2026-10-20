import { describe, it, expect } from 'vitest';
import { canonicalCompanySlug, normalizeCompanyName } from './companyMatch';

describe('normalizeCompanyName', () => {
  it('strips legal suffixes and punctuation', () => {
    expect(normalizeCompanyName('Google LLC')).toBe('google');
    expect(normalizeCompanyName('Amazon.com Services, Inc.')).toBe('amazon');
    expect(normalizeCompanyName('Space Exploration Technologies Corp.')).toBe('space exploration');
  });
});

describe('canonicalCompanySlug — big-employer aliases → seeded slug', () => {
  it('maps common legal-entity variants to the official seeded slug', () => {
    expect(canonicalCompanySlug('Google LLC')).toBe('google');
    expect(canonicalCompanySlug('Alphabet Inc.')).toBe('google');
    expect(canonicalCompanySlug('Amazon.com Services LLC')).toBe('amazon');
    expect(canonicalCompanySlug('Amazon Web Services, Inc.')).toBe('amazon');
    expect(canonicalCompanySlug('Tesla, Inc.')).toBe('tesla');
    expect(canonicalCompanySlug('Space Exploration Technologies Corp. (SpaceX)')).toBe('spacex');
    expect(canonicalCompanySlug('Kaiser Permanente')).toBe('kaiser-permanente');
    expect(canonicalCompanySlug('Sutter Health')).toBe('sutter-health');
  });

  it('maps state-government name variants to their seeded slugs', () => {
    expect(canonicalCompanySlug('State of California')).toBe('state-of-california');
    expect(canonicalCompanySlug('CalCareers')).toBe('state-of-california');
    expect(canonicalCompanySlug('New York State')).toBe('new-york-state');
    expect(canonicalCompanySlug('State of Texas')).toBe('state-of-texas');
    expect(canonicalCompanySlug('State of Washington')).toBe('state-of-washington');
  });

  it('falls back to a generic slug for companies we do not track', () => {
    expect(canonicalCompanySlug('Acme Robotics')).toBe('acme-robotics');
    expect(canonicalCompanySlug('Beta Co')).toBe('beta-co');
  });
});
