/**
 * Resolve a company's brand logo from its website domain.
 *
 * Primary source is icon.horse — a free, keyless favicon service that returns
 * the site's real high-resolution icon and genuinely 404s when a domain has no
 * icon (so the UI's onError fallback to a building icon fires cleanly). We
 * previously used Google's s2/favicons endpoint, but it responds 200 with a
 * generic globe placeholder for domains it doesn't know (e.g. anduril.com),
 * which rendered as a blank/placeholder box that onError never caught.
 *
 * An explicit logo_url always wins when present.
 */
export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Build the favicon-service URL for a bare domain (exported for the fallback chain). */
export function faviconUrl(domain: string): string {
  // icon.horse serves the real site icon (sized automatically) and 404s when
  // none exists, so the UI's onError fallback fires cleanly.
  return `https://icon.horse/icon/${encodeURIComponent(domain)}`;
}

/** Secondary favicon source, used by the UI if the primary fails to load. */
export function fallbackFaviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

export function logoForCompany(
  opts: { logoUrl?: string | null; websiteUrl?: string | null },
  size = 128,
): string | null {
  void size; // icon.horse sizes automatically; kept for call-site symmetry.
  if (opts.logoUrl) return opts.logoUrl;
  const domain = domainFromUrl(opts.websiteUrl);
  if (!domain) return null;
  return faviconUrl(domain);
}
