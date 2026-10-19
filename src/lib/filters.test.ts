import { describe, it, expect } from 'vitest';
import { parseFilters, serializeFilters, activeFilterCount, DEFAULT_FILTERS } from './filters';

describe('filters URL round-trip', () => {
  it('serializes then parses back to the same filter object', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      keyword: 'engineer',
      seasons: ['Summer', 'Fall'] as const,
      opportunityTypes: ['Internship'] as const,
      remoteOnly: true,
      degreeLevels: ['Undergraduate'] as const,
      fields: ['Technology'] as const,
      companyType: 'Startup' as const,
      sort: 'relevance' as const,
      view: 'companies' as const,
    };
    const params = serializeFilters(filters as never);
    expect(params.get('q')).toBe('engineer');
    expect(params.get('season')).toBe('summer,fall');
    expect(params.get('type')).toBe('Internship');
    expect(params.get('remote')).toBe('1');
    expect(params.get('company')).toBe('Startup');

    const parsed = parseFilters(params);
    expect(parsed.keyword).toBe('engineer');
    expect(parsed.seasons.sort()).toEqual(['Fall', 'Summer']);
    expect(parsed.remoteOnly).toBe(true);
    expect(parsed.companyType).toBe('Startup');
    expect(parsed.sort).toBe('relevance');
    expect(parsed.view).toBe('companies');
  });

  it('parses the documented example URL', () => {
    const parsed = parseFilters(new URLSearchParams('season=summer,fall&type=internship'));
    expect(parsed.seasons.sort()).toEqual(['Fall', 'Summer']);
    expect(parsed.opportunityTypes).toEqual(['internship']);
  });

  it('omits default values from the query string', () => {
    const params = serializeFilters(DEFAULT_FILTERS);
    expect(params.toString()).toBe('');
  });

  it('counts active filter groups', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, keyword: 'x', remoteOnly: true, seasons: ['Summer'] }),
    ).toBe(3);
  });

  it('maps Year-Round to a url-safe token', () => {
    const params = serializeFilters({ ...DEFAULT_FILTERS, seasons: ['Year-Round'] });
    expect(params.get('season')).toBe('year-round');
    expect(parseFilters(params).seasons).toEqual(['Year-Round']);
  });
});
