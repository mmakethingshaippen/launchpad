import type { RoleCard, CompanyCard, Season } from './adapter/types';
import type { RoleFilters, SortKey } from './filters';

function matchesLocation(role: RoleCard, filters: RoleFilters): boolean {
  if (filters.remoteOnly && role.workArrangement !== 'Remote') return false;
  const needle = `${filters.city} ${filters.state} ${filters.country}`.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${role.city ?? ''} ${role.state ?? ''} ${role.country ?? ''}`.toLowerCase();
  // each provided token must be present (AND within the location group)
  for (const tok of [filters.city, filters.state, filters.country]) {
    if (tok && !hay.includes(tok.toLowerCase())) return false;
  }
  return true;
}

function overlaps<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.some((x) => b.includes(x));
}

/** Keyword match across title, company name, field (used by Local keyword search). */
function matchesKeyword(role: RoleCard, keyword: string): boolean {
  if (!keyword) return true;
  const q = keyword.trim().toLowerCase();
  if (role.companyName.toLowerCase() === q) return true;
  return (
    role.title.toLowerCase().includes(q) ||
    role.companyName.toLowerCase().includes(q) ||
    role.field.toLowerCase().includes(q)
  );
}

/** Apply all role filters. Multi-select within a group = OR; across groups = AND. */
export function filterRoles(roles: RoleCard[], filters: RoleFilters): RoleCard[] {
  return roles.filter((role) => {
    if (!matchesKeyword(role, filters.keyword)) return false;
    if (filters.seasons.length && !overlaps(role.seasons, filters.seasons)) return false;
    if (filters.opportunityTypes.length && !filters.opportunityTypes.includes(role.opportunityType))
      return false;
    if (!matchesLocation(role, filters)) return false;
    if (filters.degreeLevels.length && !overlaps(role.degreeLevels, filters.degreeLevels))
      return false;
    if (filters.fields.length && !filters.fields.includes(role.field)) return false;
    if (filters.compensation.length && !filters.compensation.includes(role.compensationStatus))
      return false;
    if (filters.companyType !== 'All' && role.companyType !== filters.companyType) return false;
    return true;
  });
}

const SEASON_ORDER: Record<Season, number> = {
  Spring: 0,
  Summer: 1,
  Fall: 2,
  Winter: 3,
  'Year-Round': 4,
};

/**
 * Round-robin interleave roles by company (Req 9.2) so a single employer synced
 * in one batch can't monopolize the top of the "verified" feed. Stable: the
 * incoming order within each company is preserved.
 */
export function interleaveByCompany<T extends { companySlug?: string; companyName: string }>(
  roles: T[],
): T[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of roles) {
    const key = r.companySlug || r.companyName;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(r);
  }
  const out: T[] = [];
  let placed = true;
  while (placed) {
    placed = false;
    for (const key of order) {
      const bucket = buckets.get(key)!;
      if (bucket.length) {
        out.push(bucket.shift()!);
        placed = true;
      }
    }
  }
  return out;
}

function relevanceScore(role: RoleCard, keyword: string): number {
  const q = keyword.toLowerCase();
  let score = 0;
  if (role.title.toLowerCase().includes(q)) score += 3;
  if (role.companyName.toLowerCase().includes(q)) score += 2;
  if (role.field.toLowerCase().includes(q)) score += 1;
  return score;
}

function time(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}

export function sortRoles(roles: RoleCard[], sort: SortKey, keyword = ''): RoleCard[] {
  const copy = [...roles];
  switch (sort) {
    case 'recent':
      // lastVerifiedAt is a reasonable proxy for recency in seed data
      return copy.sort((a, b) => time(b.lastVerifiedAt) - time(a.lastVerifiedAt));
    case 'deadline':
      return copy.sort((a, b) => {
        const av = a.applicationDeadline ? new Date(a.applicationDeadline).getTime() : Infinity;
        const bv = b.applicationDeadline ? new Date(b.applicationDeadline).getTime() : Infinity;
        return av - bv; // soonest first; nulls last
      });
    case 'name':
      return copy.sort((a, b) => a.companyName.localeCompare(b.companyName));
    case 'relevance':
      return copy.sort((a, b) => relevanceScore(b, keyword) - relevanceScore(a, keyword));
    case 'verified':
    default: {
      const byVerified = copy.sort((a, b) => {
        const t = time(b.lastVerifiedAt) - time(a.lastVerifiedAt);
        if (t !== 0) return t;
        return SEASON_ORDER[a.seasons[0]] - SEASON_ORDER[b.seasons[0]];
      });
      // Diversify by company so one employer's batch doesn't fill the page.
      return interleaveByCompany(byVerified);
    }
  }
}

/** Filter companies: a company matches if it (or its roles) satisfy the filters. */
export function filterCompanies(
  companies: CompanyCard[],
  filters: RoleFilters,
): CompanyCard[] {
  return companies.filter((c) => {
    if (filters.companyType !== 'All' && c.companyType !== filters.companyType) return false;
    if (filters.fields.length && !overlaps(c.fields, filters.fields)) return false;
    if (filters.degreeLevels.length && !overlaps(c.degreeLevels, filters.degreeLevels)) return false;
    if (filters.startupStages.length) {
      if (!c.startupStage || !filters.startupStages.includes(c.startupStage)) return false;
    }
    if (filters.employeeRanges.length) {
      if (!c.employeeCountRange || !filters.employeeRanges.includes(c.employeeCountRange))
        return false;
    }
    if (filters.keyword) {
      const q = filters.keyword.toLowerCase();
      const hay = `${c.name} ${c.description ?? ''} ${c.fields.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
