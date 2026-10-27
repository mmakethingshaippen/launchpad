import type { WorkArrangement } from '../adapter/types';

/** Map a provider's free-form workplace string to our WorkArrangement enum. */
export function mapWorkArrangement(raw: string | null | undefined): WorkArrangement | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes('remote')) return 'Remote';
  if (v.includes('hybrid')) return 'Hybrid';
  if (v.includes('onsite') || v.includes('on-site') || v.includes('in office') || v.includes('in-office'))
    return 'Onsite';
  return undefined;
}

/** Split a "City, State, Country" style location string into parts. */
export function splitLocation(raw: string | null | undefined): {
  city?: string;
  state?: string;
  country?: string;
} {
  if (!raw) return {};
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) {
    const reversed = parts[0].match(/^([A-Za-z]{2})\s*[-–]\s*(.+)$/);
    if (reversed) return { city: reversed[2].trim(), state: reversed[1].toUpperCase() };
    return { city: parts[0] };
  }
  if (parts.length === 2) return { city: parts[0], state: parts[1] };
  return { city: parts[0], state: parts[1], country: parts.slice(2).join(', ') };
}

/** Normalize a pay period string to hour|month|year when recognizable. */
export function normalizePayPeriod(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes('hour') || v === 'hourly' || v === 'hr') return 'hour';
  if (v.includes('month')) return 'month';
  if (v.includes('year') || v.includes('annual') || v === 'yr') return 'year';
  return undefined;
}

export function isValidHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Normalize an apply URL for deduplication across connectors:
 * - lowercase host
 * - drop tracking query params (utm_*, gh_src, source, ref, etc.)
 * - drop the hash and a trailing slash
 * Returns the original string if it can't be parsed as a URL.
 */
const TRACKING_PARAM_RE = /^(utm_|gh_|ref$|source$|src$|campaign$|fbclid$|gclid$|mc_)/i;

export function normalizeApplyUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    const keep: Array<[string, string]> = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACKING_PARAM_RE.test(k)) keep.push([k, v]);
    }
    keep.sort(([a], [b]) => a.localeCompare(b));
    u.search = '';
    for (const [k, v] of keep) u.searchParams.append(k, v);
    let out = u.toString();
    // Strip a trailing slash on the path (but keep the root "/").
    out = out.replace(/\/(?=(\?|$))/, (m, _o, s: string) => (s.length <= 1 ? m : ''));
    return out.replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}
