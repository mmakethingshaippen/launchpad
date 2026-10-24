/**
 * Deduplicate listings across the data layer.
 * Dedupe key: company + normalized title + location.
 */

export interface DedupeableRole {
  title: string;
  companyId?: string | null;
  companyName?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  workArrangement?: string | null;
}

export function roleDedupeKey(role: DedupeableRole): string {
  const comp = (role.companyName ?? role.companyId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

  // Normalize title: lowercase, unify whitespace, strip common minor punctuation
  const title = role.title
    .toLowerCase()
    .replace(/[\(\)\[\]\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const loc =
    role.workArrangement === 'Remote'
      ? 'remote'
      : [role.city, role.state, role.country]
          .filter(Boolean)
          .map((s) => s!.toLowerCase().replace(/[^a-z0-9]/g, '').trim())
          .join(':');

  return `${comp}::${title}::${loc}`;
}

export function dedupeRoles<T extends DedupeableRole>(roles: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const role of roles) {
    const key = roleDedupeKey(role);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(role);
    }
  }

  return deduped;
}
