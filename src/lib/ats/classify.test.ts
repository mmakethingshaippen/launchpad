import { describe, it, expect } from 'vitest';
import {
  isEarlyCareer,
  isEarlyCareerTitle,
  matchEarlyCareerType,
  classifyOpportunityType,
} from './classify';

describe('isEarlyCareerTitle — strict title gate', () => {
  it('accepts genuine internship / co-op titles', () => {
    for (const title of [
      'Software Engineering Intern',
      'Summer Internship',
      'Data Co-op',
      'Data Coop',
      'Product Management Intern',
      'Recruiting Intern', // A2 exception: explicit intern survives recruiter guard
      'Executive Office Intern', // A1 exception: "executive" rescued by "intern"
      'MBA Intern',
      'Finance Summer Analyst',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(true);
    }
  });

  it('accepts genuine entry-level / new-grad titles', () => {
    for (const title of [
      'New Grad Software Engineer',
      'Early Career Data Analyst',
      'Entry-level Analyst',
      'Graduate Engineer',
      'Rotational Program Associate',
      'Fall Analyst, Investment Banking',
      'Software Engineering Apprenticeship',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(true);
    }
  });

  // ── Tightened rule: generic full-time "level I" / "junior" titles are NOT
  //    early-career unless the title ALSO carries an explicit intern/new-grad word. ──
  it('rejects generic full-time "Software Engineer I" / "Analyst I" / "Junior" titles', () => {
    for (const title of [
      'Software Engineer I, Backend (Collections)',
      'Software Engineer I, Frontend (Upfunnel)',
      'Software Engineer I',
      'Analyst I',
      'Associate I, Operations',
      'Developer I',
      'Junior Developer',
      'Junior Data Analyst',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(false);
    }
  });

  it('still accepts a "level I" / "junior" title when it explicitly says intern / new grad', () => {
    for (const title of [
      'Software Engineer I Intern',
      'Junior Developer - New Grad Program',
      'Analyst I, Summer Internship',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(true);
    }
  });

  // ── The reported false positives (must all be REJECTED) ──────────────────
  it('rejects senior / executive / VP / director titles (Rule A1)', () => {
    for (const title of [
      'Mortgage Banker - Assistant Vice President/ Vice President',
      'Vice President, Aladdin Client Engagement',
      'Executive Communications Strategist – Sustainability & Enterprise Operations',
      'Executive Communications Strategist',
      'Senior Software Engineer',
      'Staff Engineer',
      'Principal Scientist',
      'Director of Marketing',
      'Engineering Manager',
      'Tech Lead',
      'Sr. Analyst',
      'Senior Intern', // seniority hard token — intern cannot rescue it
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(false);
    }
  });

  it('rejects full-time recruiter / HR meta-roles even with "early career"/"university"/"campus" (Rule A2)', () => {
    for (const title of [
      'Head of Early Career Recruiting',
      'Head of Early Year Recruiting',
      'University Recruiter',
      'Early Career Recruiting Coordinator',
      'Campus Recruiting Lead',
      'Campus Recruiting Manager',
      'Early Talent Program Manager',
      'Talent Acquisition Partner',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(false);
    }
  });

  it('rejects bare campus/student/university titles without intern or grad (Rule B note)', () => {
    for (const title of [
      'Campus Marketing Representative',
      'Student Brand Ambassador',
      'University Relations Specialist',
    ]) {
      expect(isEarlyCareerTitle(title), title).toBe(false);
    }
  });

  it('never matches "internal" or "international" as "intern"', () => {
    expect(isEarlyCareerTitle('Internal Audit Associate II')).toBe(false);
    expect(isEarlyCareerTitle('International Operations Director')).toBe(false);
  });
});

describe('matchEarlyCareerType — opportunity type', () => {
  it('maps intern titles to Internship', () => {
    expect(matchEarlyCareerType('Software Engineering Intern')).toBe('Internship');
    expect(matchEarlyCareerType('Recruiting Intern')).toBe('Internship');
    expect(matchEarlyCareerType('Product Management Intern')).toBe('Internship');
  });
  it('maps co-op titles to Co-op', () => {
    expect(matchEarlyCareerType('Data Co-op')).toBe('Co-op');
    expect(matchEarlyCareerType('Software Coop')).toBe('Co-op');
  });
  it('maps new-grad / entry-level titles to Entry-level / New-grad', () => {
    expect(matchEarlyCareerType('New Grad Software Engineer')).toBe('Entry-level / New-grad');
    expect(matchEarlyCareerType('Early Career Data Analyst')).toBe('Entry-level / New-grad');
  });
  it('returns null for rejected titles', () => {
    expect(matchEarlyCareerType('Vice President, Aladdin Client Engagement')).toBeNull();
    expect(matchEarlyCareerType('University Recruiter')).toBeNull();
    expect(matchEarlyCareerType('Software Engineer I, Backend (Collections)')).toBeNull();
    expect(matchEarlyCareerType('Software Engineer I, Frontend (Upfunnel)')).toBeNull();
  });
});

describe('classifyOpportunityType never mislabels non-intern titles', () => {
  it('uses the matched type, not a hardcoded Internship', () => {
    expect(classifyOpportunityType('New Grad Software Engineer')).toBe('Entry-level / New-grad');
    expect(classifyOpportunityType('Data Co-op')).toBe('Co-op');
    expect(classifyOpportunityType('Software Engineering Intern')).toBe('Internship');
  });
});

describe('isEarlyCareer (pipeline wrapper) delegates to the strict title gate', () => {
  it('ignores employmentType=Intern when the title is clearly senior', () => {
    // Workday used to tag everything employmentTypeRaw:'Intern'; the title must win.
    expect(isEarlyCareer({ title: 'Vice President, Engineering', employmentTypeRaw: 'Intern' })).toBe(
      false,
    );
  });
  it('accepts a real intern title', () => {
    expect(isEarlyCareer({ title: 'Software Engineering Intern' })).toBe(true);
  });
  it('rejects an unrelated full-time role', () => {
    expect(isEarlyCareer({ title: 'Account Executive' })).toBe(false);
  });
});
