import { useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import { logoForCompany, domainFromUrl, fallbackFaviconUrl } from '../../lib/logo';
import { cn } from '../../lib/cn';

/**
 * Company logo with graceful fallback. Resolves a brand logo from an explicit
 * logo_url or the company website domain (favicon service); on load error it
 * falls back to a neutral building icon. Never shows a broken image.
 */
export function CompanyLogo({
  name,
  logoUrl,
  websiteUrl,
  size = 40,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const px = Math.max(64, size * 2);
  // Build an ordered source chain: explicit logo → primary favicon → secondary
  // favicon. We advance through it on each load error, landing on the building
  // icon only when every source has failed.
  const sources = useMemo(() => {
    const chain: string[] = [];
    const primary = logoForCompany({ logoUrl, websiteUrl }, px);
    if (primary) chain.push(primary);
    const domain = domainFromUrl(websiteUrl);
    if (domain) {
      const secondary = fallbackFaviconUrl(domain, px);
      if (!chain.includes(secondary)) chain.push(secondary);
    }
    return chain;
  }, [logoUrl, websiteUrl, px]);

  const [index, setIndex] = useState(0);
  const src = sources[index];

  const box = cn('flex items-center justify-center rounded-lg bg-slate-100 text-slate-400', className);
  const dim = { width: size, height: size };

  if (!src) {
    return (
      <span className={box} style={dim} aria-hidden="true">
        <Building2 style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setIndex((i) => i + 1)}
      className={cn('rounded-lg bg-white object-contain', className)}
      style={dim}
    />
  );
}
