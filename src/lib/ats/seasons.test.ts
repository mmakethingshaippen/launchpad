import { describe, it, expect } from 'vitest';
import { extractSeasons, cohortYear, isConcluded, nextOccurrenceYear, roleConcluded } from './seasons';

describe('extractSeasons', () => {
  it('tags a single season', () => {
    expect(extractSeasons('Summer 2027 Internship')).toEqual(['Summer']);
    expect(extractSeasons('Autumn research role')).toEqual(['Fall']);
  });

  it('tags multiple seasons when present', () => {
    expect(extractSeasons('Fall/Winter Co-op').sort()).toEqual(['Fall', 'Winter']);
    expect(extractSeasons('Spring or Summer Intern').sort()).toEqual(['Spring', 'Summer']);
  });

  it('defaults to Year-Round when no season is stated', () => {
    expect(extractSeasons('Rolling startup internship')).toEqual(['Year-Round']);
    expect(extractSeasons('New Grad Software Engineer')).toEqual(['Year-Round']);
  });
});

describe('cohortYear', () => {
  it('parses a 4-digit year from the title', () => {
    expect(cohortYear('Summer 2027 Internship')).toBe(2027);
  });
  it('returns null when absent', () => {
    expect(cohortYear('Summer Internship')).toBeNull();
  });
});

describe('isConcluded (UTC boundaries, decision #4)', () => {
  it('marks a past stated cohort year as concluded', () => {
    const now = new Date(Date.UTC(2026, 0, 15));
    expect(isConcluded('Summer', 2025, now)).toBe(true);
  });

  it('respects the exact Summer cutoff (Aug 31) in UTC', () => {
    const beforeCutoff = new Date(Date.UTC(2026, 7, 31, 12, 0, 0)); // Aug 31 noon UTC
    const afterCutoff = new Date(Date.UTC(2026, 8, 1, 0, 0, 0)); // Sep 1 UTC
    expect(isConcluded('Summer', 2026, beforeCutoff)).toBe(false);
    expect(isConcluded('Summer', 2026, afterCutoff)).toBe(true);
  });

  it('respects the Fall cutoff (Dec 15) in UTC', () => {
    expect(isConcluded('Fall', 2026, new Date(Date.UTC(2026, 11, 15, 12, 0, 0)))).toBe(false);
    expect(isConcluded('Fall', 2026, new Date(Date.UTC(2026, 11, 16, 0, 0, 0)))).toBe(true);
  });

  it('never concludes Year-Round', () => {
    expect(isConcluded('Year-Round', null, new Date(Date.UTC(2030, 0, 1)))).toBe(false);
  });

  it('assumes next occurrence when no year stated, so live postings are not rejected', () => {
    // On Oct 1 2026, Summer with no year → next occurrence is Summer 2027, not concluded.
    const now = new Date(Date.UTC(2026, 9, 1));
    expect(isConcluded('Summer', null, now)).toBe(false);
  });
});

describe('nextOccurrenceYear', () => {
  it('uses this year before the cutoff, next year after', () => {
    expect(nextOccurrenceYear('Summer', new Date(Date.UTC(2026, 0, 1)))).toBe(2026);
    expect(nextOccurrenceYear('Summer', new Date(Date.UTC(2026, 9, 1)))).toBe(2027);
  });
});

describe('roleConcluded', () => {
  it('is alive if any Year-Round tag present', () => {
    expect(roleConcluded(['Year-Round', 'Summer'], 2020, new Date(Date.UTC(2026, 0, 1)))).toBe(false);
  });
  it('concluded only when all specific seasons concluded', () => {
    const now = new Date(Date.UTC(2026, 0, 1));
    expect(roleConcluded(['Summer'], 2025, now)).toBe(true);
    expect(roleConcluded(['Summer', 'Fall'], 2026, now)).toBe(false); // 2026 not concluded yet
  });
});
