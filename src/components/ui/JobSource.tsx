/** Visible source credit required by Himalayas' public API terms. */
export function himalayasSourceUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && url.hostname === 'himalayas.app' && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

export function JobSource({ sourceUrl }: { sourceUrl?: string | null }) {
  const href = himalayasSourceUrl(sourceUrl);
  return href ? <p className="text-xs text-slate-500">Source: <a className="underline" href={href} target="_blank" rel="noopener noreferrer">Himalayas</a></p> : null;
}
