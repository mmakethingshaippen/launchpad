import { describe, it, expect } from 'vitest';
import { classifyCompanyByName, resolveCompanyClassification } from './classifyCompany';

describe('classifyCompanyByName (Req 4)', () => {
  it('maps known big employers to a real industry + Established Company + size', () => {
    expect(classifyCompanyByName('TikTok')).toMatchObject({
      fields: ['Technology'],
      companyType: 'Established Company',
      employeeRange: '501+',
    });
    expect(classifyCompanyByName('GE Healthcare')?.fields).toEqual(['Healthcare']);
    expect(classifyCompanyByName('IMC Trading')?.fields).toEqual(['Finance']);
    expect(classifyCompanyByName('Ross Stores')?.fields).toEqual(['Business']); // retail → Business
  });

  it('returns null for an unknown company', () => {
    expect(classifyCompanyByName('Totally Unknown Co')).toBeNull();
  });
});

describe('resolveCompanyClassification — never yields "Other / Unknown"', () => {
  it('upgrades an Other / Unknown company with no fields to a clean default', () => {
    const r = resolveCompanyClassification({
      name: 'Mystery Labs',
      fields: [],
      companyType: 'Other / Unknown',
      employeeRange: null,
    });
    expect(r.companyType).not.toBe('Other / Unknown');
    expect(r.companyType).toBe('Established Company');
    expect(r.fields.length).toBeGreaterThan(0);
    expect(r.fields).not.toContain('Other');
    expect(r.employeeRange).toBe('501+');
  });

  it('prefers a known brand mapping over existing values', () => {
    const r = resolveCompanyClassification({
      name: 'TikTok',
      fields: ['Other'],
      companyType: 'Other / Unknown',
      employeeRange: null,
    });
    expect(r.fields).toEqual(['Technology']);
    expect(r.companyType).toBe('Established Company');
  });

  it('keeps real existing fields for an unknown company', () => {
    const r = resolveCompanyClassification({
      name: 'Some Biotech Startup',
      fields: ['Healthcare'],
      companyType: 'Startup',
      employeeRange: '11-50',
    });
    expect(r.fields).toEqual(['Healthcare']);
    expect(r.companyType).toBe('Startup'); // not downgraded
    expect(r.employeeRange).toBe('11-50');
  });
});
