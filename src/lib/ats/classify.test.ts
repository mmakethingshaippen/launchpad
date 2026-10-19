import { describe, it, expect } from 'vitest';
import { isEarlyCareer } from './classify';

describe('isEarlyCareer', () => {
  it('includes intern / internship / co-op / new grad / entry-level titles', () => {
    for (const title of [
      'Software Engineering Intern',
      'Summer Internship',
      'Data Co-op',
      'Data Coop',
      'New Grad Software Engineer',
      'Entry-level Analyst',
      'Marketing Fellow',
      'Engineering Apprentice',
      'University Grad - Product',
      'Campus Recruiting Program',
    ]) {
      expect(isEarlyCareer({ title }), title).toBe(true);
    }
  });

  it('includes when employmentType is exactly Intern', () => {
    expect(isEarlyCareer({ title: 'Design', employmentTypeRaw: 'Intern' })).toBe(true);
  });

  it('excludes senior/mid-level titles (exclusion wins over intern keyword)', () => {
    for (const title of [
      'Senior Software Engineer',
      'Staff Engineer',
      'Principal Scientist',
      'Director of Marketing',
      'Engineering Manager',
      'Tech Lead',
      'Sr. Analyst',
      'Senior Intern', // exclusion must win
    ]) {
      expect(isEarlyCareer({ title }), title).toBe(false);
    }
  });

  it('excludes unrelated full-time roles', () => {
    expect(isEarlyCareer({ title: 'Account Executive' })).toBe(false);
  });
});
