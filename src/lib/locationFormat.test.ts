import { describe, it, expect } from 'vitest';
import { formatLocation } from './locationFormat';

describe('formatLocation', () => {
  it('formats US locations as City, State abbr', () => {
    expect(formatLocation({ city: 'San Francisco', state: 'CA' })).toBe('San Francisco, CA');
    expect(formatLocation({ city: 'Austin', state: 'Texas' })).toBe('Austin, TX');
    expect(formatLocation({ city: 'Seattle', state: 'WA' })).toBe('Seattle, WA');
  });

  it('formats international locations as City, Full Country Name', () => {
    expect(formatLocation({ city: 'Penang', state: 'MYS' })).toBe('Penang, Malaysia');
    expect(formatLocation({ city: 'Treviso', state: 'ITA' })).toBe('Treviso, Italy');
  });

  it('collapses Singapore, SGP into Singapore', () => {
    expect(formatLocation({ city: 'Singapore', state: 'SGP' })).toBe('Singapore');
  });

  it('formats Costa Rica San Francisco without 3-letter country code', () => {
    const loc = formatLocation({ city: 'San Francisco', state: 'CRI' });
    expect(loc).toBe('San Francisco, Costa Rica');
    expect(loc.endsWith('CRI')).toBe(false);
  });

  it('never leaves a trailing 3-letter country code', () => {
    const samples = [
      { city: 'Penang', state: 'MYS' },
      { city: 'Treviso', state: 'ITA' },
      { city: 'Munich', state: 'DEU' },
      { city: 'London', state: 'GBR' },
      { city: 'Tokyo', state: 'JPN' },
    ];
    for (const s of samples) {
      const formatted = formatLocation(s);
      expect(formatted).not.toMatch(/,\s*[A-Z]{3}$/);
    }
  });

  it('preserves Remote and Hybrid indicators', () => {
    expect(formatLocation({ city: 'Austin', state: 'TX', workArrangement: 'Remote' })).toBe('Remote');
    expect(formatLocation({ city: 'Austin', state: 'TX', workArrangement: 'Hybrid' })).toBe('Austin, TX · Hybrid');
  });
});
