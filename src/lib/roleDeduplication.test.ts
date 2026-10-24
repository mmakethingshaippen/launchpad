import { describe, it, expect } from 'vitest';
import { dedupeRoles, roleDedupeKey } from './roleDeduplication';

describe('roleDeduplication', () => {
  it('deduplicates case variants of identical roles at the same location', () => {
    const roles = [
      { companyName: 'Applied Materials', title: 'College Intern', city: 'Singapore', state: 'SGP' },
      { companyName: 'Applied Materials', title: 'College intern', city: 'Singapore', state: 'SGP' },
      { companyName: 'Applied Materials', title: 'COLLEGE INTERN', city: 'Singapore', state: 'SGP' },
    ];
    const deduped = dedupeRoles(roles);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe('College Intern');
  });

  it('keeps distinct locations for the same role title', () => {
    const roles = [
      { companyName: 'Applied Materials', title: 'College Intern', city: 'Singapore', state: 'SGP' },
      { companyName: 'Applied Materials', title: 'College Intern', city: 'Penang', state: 'MYS' },
    ];
    const deduped = dedupeRoles(roles);
    expect(deduped).toHaveLength(2);
  });

  it('generates consistent dedupe keys across casing and minor punctuation', () => {
    const k1 = roleDedupeKey({
      companyName: 'Google',
      title: 'Software Engineering Intern',
      city: 'Mountain View',
      state: 'CA',
    });
    const k2 = roleDedupeKey({
      companyName: 'google',
      title: 'software engineering intern',
      city: 'mountain view',
      state: 'ca',
    });
    expect(k1).toBe(k2);
  });

  it('deduplicates remote roles with identical title and company', () => {
    const roles = [
      {
        companyName: 'Stripe',
        title: 'Backend Engineering Intern',
        workArrangement: 'Remote',
      },
      {
        companyName: 'Stripe',
        title: 'backend engineering intern',
        workArrangement: 'Remote',
      },
    ];
    const deduped = dedupeRoles(roles);
    expect(deduped).toHaveLength(1);
  });

  it('normalizes bracketed and dashed title noise', () => {
    const k1 = roleDedupeKey({
      companyName: 'Applied Materials',
      title: 'Intern (Summer 2027)',
      city: 'Santa Clara',
      state: 'CA',
    });
    const k2 = roleDedupeKey({
      companyName: 'Applied Materials',
      title: 'Intern - Summer 2027',
      city: 'Santa Clara',
      state: 'CA',
    });
    expect(k1).toBe(k2);
  });

  it('falls back to companyId if companyName is absent', () => {
    const r1 = { companyId: 'comp-123', title: 'Intern', city: 'Austin', state: 'TX' };
    const r2 = { companyId: 'comp-123', title: 'intern', city: 'Austin', state: 'TX' };
    expect(dedupeRoles([r1, r2])).toHaveLength(1);
  });
});
