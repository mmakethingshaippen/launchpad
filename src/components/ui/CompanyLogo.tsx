import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { logoForCompany } from '../../lib/logo';
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
  const resolved = logoForCompany({ logoUrl, websiteUrl }, Math.max(64, size * 2));
  const [failed, setFailed] = useState(false);

  const box = cn('flex items-center justify-center rounded-lg bg-slate-100 text-slate-400', className);
  const dim = { width: size, height: size };

  if (!resolved || failed) {
    return (
      <span className={box} style={dim} aria-hidden="true">
        <Building2 style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }

  return (
    <img
      src={resolved}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('rounded-lg bg-white object-contain', className)}
      style={dim}
    />
  );
}
