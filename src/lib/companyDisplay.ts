/** Returns company fields once each, ignoring casing and surrounding whitespace. */
export function uniqueCompanyFields(fields: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  return (fields ?? []).reduce<string[]>((result, field) => {
    const label = field?.trim();
    const key = label?.toLocaleLowerCase();
    if (!label || label === 'Other' || !key || seen.has(key)) return result;
    seen.add(key);
    result.push(label);
    return result;
  }, []);
}

/** Hides imported metadata placeholders instead of presenting them as a company bio. */
export function visibleCompanyDescription(description: string | null | undefined): string | null {
  const value = description?.trim();
  if (!value || /^opportunities aggregated from simplify\.?$/i.test(value)) return null;
  return value;
}
