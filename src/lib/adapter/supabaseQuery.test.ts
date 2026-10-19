import { describe, it, expect } from 'vitest';
import { buildRolePlan } from './supabaseQuery';
import { DEFAULT_FILTERS } from '../filters';

describe('buildRolePlan', () => {
  it('maps seasons and degree levels to array overlap (OR within group)', () => {
    const plan = buildRolePlan({ ...DEFAULT_FILTERS, seasons: ['Summer', 'Fall'], degreeLevels: ['Undergraduate'] });
    expect(plan.filters).toContainEqual({ type: 'overlaps', column: 'seasons', values: ['Summer', 'Fall'] });
    expect(plan.filters).toContainEqual({ type: 'overlaps', column: 'degree_levels', values: ['Undergraduate'] });
  });

  it('maps scalar multi-selects to IN', () => {
    const plan = buildRolePlan({ ...DEFAULT_FILTERS, opportunityTypes: ['Internship', 'Co-op'], fields: ['Technology'] });
    expect(plan.filters).toContainEqual({ type: 'in', column: 'opportunity_type', values: ['Internship', 'Co-op'] });
    expect(plan.filters).toContainEqual({ type: 'in', column: 'field', values: ['Technology'] });
  });

  it('adds remote-only as an equality on work_arrangement', () => {
    const plan = buildRolePlan({ ...DEFAULT_FILTERS, remoteOnly: true });
    expect(plan.filters).toContainEqual({ type: 'eq', column: 'work_arrangement', value: 'Remote' });
  });

  it('includes full-text search only when a keyword is present', () => {
    expect(buildRolePlan({ ...DEFAULT_FILTERS }).textSearch).toBeNull();
    expect(buildRolePlan({ ...DEFAULT_FILTERS, keyword: 'engineer' }).textSearch).toBe('engineer');
  });

  it('orders by last_verified_at desc by default and by deadline asc when selected', () => {
    expect(buildRolePlan(DEFAULT_FILTERS).order).toMatchObject({ column: 'last_verified_at', ascending: false });
    expect(buildRolePlan({ ...DEFAULT_FILTERS, sort: 'deadline' }).order).toMatchObject({
      column: 'application_deadline',
      ascending: true,
    });
  });

  it('computes pagination range from the page number', () => {
    expect(buildRolePlan({ ...DEFAULT_FILTERS, page: 2 }).range).toEqual({ from: 24, to: 47 });
  });
});
