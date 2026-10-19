import type { ReactNode } from 'react';
import type { Season } from '../../lib/adapter/types';
import { cn } from '../../lib/cn';

const SEASON_STYLES: Record<Season, string> = {
  Spring: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  Summer: 'bg-amber-100 text-amber-800 ring-amber-200',
  Fall: 'bg-orange-100 text-orange-800 ring-orange-200',
  Winter: 'bg-sky-100 text-sky-800 ring-sky-200',
  'Year-Round': 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function SeasonBadge({ season, year }: { season: Season; year?: number | null }) {
  const label = season === 'Year-Round' ? 'Year-Round' : year ? `${season} ${year}` : season;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        SEASON_STYLES[season],
      )}
    >
      {label}
    </span>
  );
}

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'cyan' | 'navy' | 'muted';
  className?: string;
}) {
  const tones = {
    default: 'bg-slate-100 text-slate-700 ring-slate-200',
    cyan: 'bg-cyan/10 text-cyan ring-cyan/30',
    navy: 'bg-navy/10 text-navy ring-navy/20',
    muted: 'bg-slate-50 text-slate-500 ring-slate-200',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
