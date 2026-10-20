import { describe, it, expect } from 'vitest';
import { classifyField, classifyOpportunityType, classifyDegreeLevels } from './classify';

describe('classifyField', () => {
  it('maps analytics/engineering titles to Technology (not Other)', () => {
    expect(classifyField('Data Analyst Intern')).toBe('Technology');
    expect(classifyField('Software Engineering Intern')).toBe('Technology');
    expect(classifyField('Machine Learning Intern')).toBe('Technology');
    expect(classifyField('Technical Operations Intern')).toBe('Technology');
  });

  it('maps financial titles to Finance (beating the generic data/analyst rule)', () => {
    expect(classifyField('Financial Data Analyst Intern')).toBe('Finance');
    expect(classifyField('Investment Banking Analyst')).toBe('Finance');
  });

  it('maps business/ops titles to Business', () => {
    expect(classifyField('Business Analyst Intern')).toBe('Business');
    expect(classifyField('Operations Intern')).toBe('Business');
    expect(classifyField('Product Management Intern')).toBe('Business');
  });

  it('maps hardware/mechanical titles to Engineering', () => {
    expect(classifyField('Mechanical Engineering Intern')).toBe('Engineering');
    expect(classifyField('Robotics Intern')).toBe('Engineering');
  });

  it('maps marketing and healthcare titles', () => {
    expect(classifyField('Growth Marketing Intern')).toBe('Marketing');
    expect(classifyField('Clinical Research Intern')).toBe('Healthcare');
  });

  it('falls back to the company field, then Other', () => {
    expect(classifyField('Generalist Intern', 'Finance')).toBe('Finance');
    expect(classifyField('Zxqw Intern')).toBe('Other');
  });
});

describe('classifyOpportunityType', () => {
  it('detects co-op, new-grad, and internship', () => {
    expect(classifyOpportunityType('Fall Data Co-op')).toBe('Co-op');
    expect(classifyOpportunityType('New Grad Software Engineer')).toBe('Entry-level / New-grad');
    expect(classifyOpportunityType('Summer Analyst Intern')).toBe('Internship');
  });
});

describe('classifyDegreeLevels', () => {
  it('never returns an empty list (no "Any level")', () => {
    expect(classifyDegreeLevels('Software Intern', 'Internship')).toContain('Undergraduate');
    expect(classifyDegreeLevels('New Grad Engineer', 'Entry-level / New-grad')).toContain('New Grad');
  });

  it('adds Graduate when the title signals an advanced degree', () => {
    expect(classifyDegreeLevels('PhD Research Intern', 'Internship')).toContain('Graduate');
  });
});
