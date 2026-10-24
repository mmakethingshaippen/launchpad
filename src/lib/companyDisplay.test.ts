import { describe, it, expect } from 'vitest';
import { uniqueCompanyFields, visibleCompanyDescription } from './companyDisplay';

describe('companyDisplay', () => {
  describe('visibleCompanyDescription', () => {
    it('hides "Opportunities aggregated from simplify." case-insensitively', () => {
      expect(visibleCompanyDescription('Opportunities aggregated from simplify.')).toBeNull();
      expect(visibleCompanyDescription('opportunities aggregated from simplify')).toBeNull();
      expect(visibleCompanyDescription('  OPPORTUNITIES AGGREGATED FROM SIMPLIFY.  ')).toBeNull();
    });

    it('returns valid real company descriptions unchanged', () => {
      const realBio = 'Applied Materials is the leader in materials engineering solutions.';
      expect(visibleCompanyDescription(realBio)).toBe(realBio);
    });

    it('returns null for empty or whitespace-only descriptions', () => {
      expect(visibleCompanyDescription('')).toBeNull();
      expect(visibleCompanyDescription('   ')).toBeNull();
      expect(visibleCompanyDescription(null)).toBeNull();
      expect(visibleCompanyDescription(undefined)).toBeNull();
    });
  });

  describe('uniqueCompanyFields', () => {
    it('deduplicates case-variant fields', () => {
      const fields = ['Technology', 'technology', 'TECHNOLOGY'];
      expect(uniqueCompanyFields(fields)).toEqual(['Technology']);
    });

    it('filters out "Other" field', () => {
      const fields = ['Technology', 'Other', 'Healthcare'];
      expect(uniqueCompanyFields(fields)).toEqual(['Technology', 'Healthcare']);
    });

    it('preserves distinct fields and trims whitespace', () => {
      const fields = [' Technology ', 'Finance', 'Healthcare '];
      expect(uniqueCompanyFields(fields)).toEqual(['Technology', 'Finance', 'Healthcare']);
    });

    it('handles null, undefined, or empty arrays gracefully', () => {
      expect(uniqueCompanyFields(null)).toEqual([]);
      expect(uniqueCompanyFields(undefined)).toEqual([]);
      expect(uniqueCompanyFields([])).toEqual([]);
    });
  });
});
