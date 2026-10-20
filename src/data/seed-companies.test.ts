import { describe, it, expect } from 'vitest';
import { SEED_COMPANIES } from './seed-companies';
import { parseWorkdayToken } from '../lib/ats/providers/workday';

function bySlug(slug: string) {
  return SEED_COMPANIES.find((c) => c.slug === slug);
}

describe('seed companies — Waymo, PayPal, Applied Materials (Req 1)', () => {
  it('seeds Waymo with a Greenhouse feed and Mountain View HQ', () => {
    const waymo = bySlug('waymo');
    expect(waymo).toBeDefined();
    expect(waymo!.atsProvider).toBe('greenhouse');
    expect(waymo!.atsBoardToken).toBe('waymo');
    expect(waymo!.locations[0]).toMatchObject({ city: 'Mountain View', state: 'CA' });
  });

  it('seeds PayPal with a Workday feed and San Jose HQ', () => {
    const paypal = bySlug('paypal');
    expect(paypal).toBeDefined();
    expect(paypal!.atsProvider).toBe('workday');
    expect(parseWorkdayToken(paypal!.atsBoardToken!)).not.toBeNull();
    expect(paypal!.locations[0]).toMatchObject({ city: 'San Jose', state: 'CA' });
  });

  it('seeds Applied Materials with a valid Workday token and Santa Clara HQ', () => {
    const amat = bySlug('applied-materials');
    expect(amat).toBeDefined();
    expect(amat!.name).toBe('Applied Materials');
    expect(amat!.atsProvider).toBe('workday');
    const coords = parseWorkdayToken(amat!.atsBoardToken!);
    expect(coords).toMatchObject({ host: 'amat.wd1.myworkdayjobs.com', tenant: 'amat', site: 'External' });
    expect(amat!.locations[0]).toMatchObject({ city: 'Santa Clara', state: 'CA' });
    expect(amat!.fields).toContain('Engineering');
  });

  it('every seed company has a unique slug', () => {
    const slugs = SEED_COMPANIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('no seed company is left as "Other / Unknown" (Req 7)', () => {
    for (const c of SEED_COMPANIES) {
      expect(c.companyType, c.name).not.toBe('Other / Unknown');
    }
  });
});
