import { describe, it, expect } from 'vitest';
import { isUsableCity } from './supabaseSink';

describe('isUsableCity — reject junk / multi-office location text', () => {
  it('accepts real city names', () => {
    for (const c of ['Santa Clara', 'New York', 'San Francisco', 'London']) {
      expect(isUsableCity(c), c).toBe(true);
    }
  });

  it('rejects empty / N/A / Location N/A', () => {
    for (const c of ['', '   ', 'N/A', 'NA', 'n/a', 'Location N/A', 'location na']) {
      expect(isUsableCity(c), JSON.stringify(c)).toBe(false);
    }
    expect(isUsableCity(null)).toBe(false);
    expect(isUsableCity(undefined)).toBe(false);
  });

  it('rejects Workday multi-office counts', () => {
    for (const c of ['2 Locations', '3 locations', '10 Locations', 'Multiple Locations', 'Various Locations']) {
      expect(isUsableCity(c), c).toBe(false);
    }
  });
});
