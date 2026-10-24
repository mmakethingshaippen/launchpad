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

  it('generates consistent dedupe keys', () => {
    const k1 = roleDedupeKey({ companyName: 'Google', title: 'Software Engineering Intern', city: 'Mountain View', state: 'CA' });
    const k2 = roleDedupeKey({ companyName: 'google', title: 'software engineering intern', city: 'mountain view', state: 'ca' });
    expect(k1).toBe(k2);
  });
});
