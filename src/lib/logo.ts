/**
 * Resolve a company's brand logo from its website domain.
 *
 * Uses Google's public favicon service (no API key, high availability). The UI
 * provides an onError fallback to a building icon, so a missing logo degrades
 * gracefully. If a company already has an explicit logo_url, that is preferred.
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

export function logoForCompany(
  opts: { logoUrl?: string | null; websiteUrl?: string | null },
  size = 128,
): string | null {
  if (opts.logoUrl) return opts.logoUrl;
  const domain = domainFromUrl(opts.websiteUrl);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}
