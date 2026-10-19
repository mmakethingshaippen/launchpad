import { describe, it, expect } from 'vitest';
import { companyFormSchema, roleFormSchema } from './submitSchemas';

describe('companyFormSchema', () => {
  const valid = {
    name: 'Acme',
    websiteUrl: 'https://acme.test',
    careersUrl: 'https://acme.test/careers',
    description: 'A real company doing real things.',
    fields: ['Technology'],
    companyType: 'Startup',
    degreeLevels: ['Undergraduate'],
  };

  it('accepts a valid company submission', () => {
    expect(companyFormSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an invalid website URL', () => {
    const r = companyFormSchema.safeParse({ ...valid, websiteUrl: 'not-a-url' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.websiteUrl?.[0]).toMatch(/valid URL/);
  });

  it('requires at least one field', () => {
    const r = companyFormSchema.safeParse({ ...valid, fields: [] });
    expect(r.success).toBe(false);
  });

  it('flags a filled honeypot', () => {
    const r = companyFormSchema.safeParse({ ...valid, website_hp: 'i am a bot' });
    expect(r.success).toBe(false);
  });
});

describe('roleFormSchema', () => {
  const valid = {
    companyName: 'Acme',
    title: 'Software Intern',
    field: 'Technology',
    seasons: ['Summer'],
    workArrangement: 'Remote',
    degreeLevels: ['Undergraduate'],
    opportunityType: 'Internship',
    workSchedule: 'Full-time',
    compensationStatus: 'Paid',
    applyUrl: 'https://acme.test/apply',
    description: 'A genuinely detailed role description here.',
  };

  it('accepts a valid role submission', () => {
    expect(roleFormSchema.safeParse(valid).success).toBe(true);
  });

  it('requires a company id or name', () => {
    const { companyName: _omit, ...rest } = valid;
    void _omit;
    const r = roleFormSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('requires at least one season', () => {
    expect(roleFormSchema.safeParse({ ...valid, seasons: [] }).success).toBe(false);
  });

  it('rejects a too-short description', () => {
    expect(roleFormSchema.safeParse({ ...valid, description: 'short' }).success).toBe(false);
  });
});
