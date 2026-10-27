import { describe, it, expect } from 'vitest';
import { formatLocation, resolveCountryName } from './locationFormat';

describe('formatLocation', () => {
  it('formats US locations as City, State abbr', () => {
    expect(formatLocation({ city: 'San Francisco', state: 'CA' })).toBe('San Francisco, CA');
    expect(formatLocation({ city: 'Austin', state: 'Texas' })).toBe('Austin, TX');
    expect(formatLocation({ city: 'Seattle', state: 'WA' })).toBe('Seattle, WA');
  });

  it('infers state abbreviation for major US cities when state is omitted', () => {
    expect(formatLocation({ city: 'San Francisco' })).toBe('San Francisco, CA');
    expect(formatLocation({ city: 'Seattle' })).toBe('Seattle, WA');
    expect(formatLocation({ city: 'New York', country: 'United States' })).toBe('New York, NY');
  });

  it('formats international locations as City, Full Country Name', () => {
    expect(formatLocation({ city: 'Penang', state: 'MYS' })).toBe('Penang, Malaysia');
    expect(formatLocation({ city: 'Treviso', state: 'ITA' })).toBe('Treviso, Italy');
    expect(formatLocation({ city: 'Munich', state: 'DEU' })).toBe('Munich, Germany');
    expect(formatLocation({ city: 'London', state: 'GBR' })).toBe('London, United Kingdom');
  });

  it('collapses Singapore, SGP or Singapore, Singapore into Singapore', () => {
    expect(formatLocation({ city: 'Singapore', state: 'SGP' })).toBe('Singapore');
    expect(formatLocation({ city: 'Singapore', country: 'Singapore' })).toBe('Singapore');
  });

  it('formats Costa Rica San Francisco without 3-letter country code', () => {
    const loc = formatLocation({ city: 'San Francisco', state: 'CRI' });
    expect(loc).toBe('San Francisco, Costa Rica');
    expect(loc.endsWith('CRI')).toBe(false);
  });

  it('never leaves a trailing 3-letter country code across diverse countries', () => {
    const samples = [
      { city: 'Penang', state: 'MYS' },
      { city: 'Treviso', state: 'ITA' },
      { city: 'Munich', state: 'DEU' },
      { city: 'London', state: 'GBR' },
      { city: 'Tokyo', state: 'JPN' },
      { city: 'Toronto', state: 'CAN' },
      { city: 'Sydney', state: 'AUS' },
    ];
    for (const s of samples) {
      const formatted = formatLocation(s);
      expect(formatted).not.toMatch(/,\s*[A-Z]{3}$/);
    }
  });

  it('cleans ATS multi-token and USA strings so US locations render as city and state only', () => {
    // Exact Waymo listing pattern: "CA USA; San Francisco"
    expect(
      formatLocation({
        city: 'Mountain View',
        state: 'CA USA;  San Francisco',
        country: 'CA USA;',
      })
    ).toBe('Mountain View, CA');

    // ATS multi-location string in country
    expect(
      formatLocation({
        city: 'Austin',
        state: 'Texas',
        country: 'USA; Dallas-Fort Worth, Texas, USA; Los Angeles, California, USA',
      })
    ).toBe('Austin, TX');

    // Composite city with state and USA
    expect(formatLocation({ city: 'Mountain View, CA USA' })).toBe('Mountain View, CA');
    expect(formatLocation({ city: 'Mountain View, CA, USA' })).toBe('Mountain View, CA');

    // State with USA suffix
    expect(formatLocation({ city: 'Irvine', state: 'CA USA' })).toBe('Irvine, CA');
    expect(formatLocation({ city: 'San Francisco', state: 'California USA' })).toBe('San Francisco, CA');

    // Country as USA
    expect(formatLocation({ city: 'Mountain View', state: 'CA', country: 'USA' })).toBe('Mountain View, CA');
  });

  it('preserves Remote and Hybrid indicators', () => {
    expect(formatLocation({ city: 'Austin', state: 'TX', workArrangement: 'Remote' })).toBe('Remote');
    expect(formatLocation({ city: 'Austin', state: 'TX', workArrangement: 'Hybrid' })).toBe('Austin, TX · Hybrid');
  });

  it('cleans trailing punctuation and returns Location N/A when empty', () => {
    expect(formatLocation({ city: 'Austin,', state: 'TX;' })).toBe('Austin, TX');
    expect(formatLocation({})).toBe('Location N/A');
    expect(formatLocation({ city: '06988 - North Carolina CVS Pharmacy, L.L.C.' })).toBe('NC');
    expect(formatLocation({ city: '06139 - Ohio CVS Stores, L.L.C.' })).toBe('OH');
    expect(formatLocation({ city: '01744 - German Dobson CVS, L.L.C.' })).toBe('Location N/A');
    expect(formatLocation({ city: 'Lyman', state: 'SC' })).toBe('Lyman, SC');
  });
});

describe('resolveCountryName', () => {
  it('resolves ISO codes and common tokens to country names', () => {
    expect(resolveCountryName('SGP')).toBe('Singapore');
    expect(resolveCountryName('MYS')).toBe('Malaysia');
    expect(resolveCountryName('ITA')).toBe('Italy');
    expect(resolveCountryName('USA')).toBe('United States');
    expect(resolveCountryName('UK')).toBe('United Kingdom');
  });
});
