import { Info } from 'lucide-react';
import { FRESHNESS_NOTE } from '../../lib/freshness';

/** Public note shown wherever job listings or job counts appear. */
export function FreshnessNote({ className = '' }: { className?: string }) {
  return (
    <p className={`inline-flex items-center gap-1.5 text-xs text-slate-500 ${className}`.trim()}>
      <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      {FRESHNESS_NOTE}
    </p>
  );
}