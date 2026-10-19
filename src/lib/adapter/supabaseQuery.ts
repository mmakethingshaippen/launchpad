import type { RoleFilters } from '../filters';

/**
 * A declarative description of how a RoleFilters maps to Supabase/PostgREST
 * query operations. Extracted as a pure function so the semantics (OR within a
 * group, AND across groups, array-overlap for seasons/degrees) are unit-testable
 * without a live database.
 */
export interface QueryPlan {
  /** eq/ilike/overlaps/in operations applied with AND across entries. */
  filters: QueryOp[];
  /** full-text search query string, if keyword present. */
  textSearch: string | null;
  order: { column: string; ascending: boolean; nullsFirst?: boolean };
  range: { from: number; to: number };
}

export type QueryOp =
  | { type: 'eq'; column: string; value: string | boolean }
  | { type: 'overlaps'; column: string; values: string[] }
  | { type: 'in'; column: string; values: string[] }
  | { type: 'ilike'; column: string; value: string };

const PAGE_SIZE = 24;

export function buildRolePlan(filters: RoleFilters): QueryPlan {
  const ops: QueryOp[] = [];

  // Season/degree are arrays → overlap (OR within the group).
  if (filters.seasons.length) ops.push({ type: 'overlaps', column: 'seasons', values: filters.seasons });
  if (filters.degreeLevels.length)
    ops.push({ type: 'overlaps', column: 'degree_levels', values: filters.degreeLevels });

  // Scalar multi-select → IN (OR within the group).
  if (filters.opportunityTypes.length)
    ops.push({ type: 'in', column: 'opportunity_type', values: filters.opportunityTypes });
  if (filters.fields.length) ops.push({ type: 'in', column: 'field', values: filters.fields });
  if (filters.compensation.length)
    ops.push({ type: 'in', column: 'compensation_status', values: filters.compensation });

  // Single-value toggles/choices.
  if (filters.remoteOnly) ops.push({ type: 'eq', column: 'work_arrangement', value: 'Remote' });
  if (filters.city) ops.push({ type: 'ilike', column: 'city', value: `%${filters.city}%` });
  if (filters.state) ops.push({ type: 'ilike', column: 'state', value: `%${filters.state}%` });
  if (filters.country) ops.push({ type: 'ilike', column: 'country', value: `%${filters.country}%` });

  const order = (() => {
    switch (filters.sort) {
      case 'recent':
        return { column: 'created_at', ascending: false };
      case 'deadline':
        return { column: 'application_deadline', ascending: true, nullsFirst: false };
      case 'name':
        return { column: 'title', ascending: true };
      case 'relevance':
      case 'verified':
      default:
        return { column: 'last_verified_at', ascending: false };
    }
  })();

  const from = (filters.page - 1) * PAGE_SIZE;

  return {
    filters: ops,
    textSearch: filters.keyword ? filters.keyword : null,
    order,
    range: { from, to: from + PAGE_SIZE - 1 },
  };
}
