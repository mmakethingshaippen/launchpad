import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Compute the sequence of page tokens to render: always first & last, the
 * current page with one neighbor on each side, and 'ellipsis' gaps between.
 *
 * e.g. page 5 of 76 → [1, '…', 4, 5, 6, '…', 76]
 */
export function paginationRange(current: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 1) return [1];
  const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const out: Array<number | 'ellipsis'> = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('ellipsis');
    out.push(p);
    prev = p;
  }
  return out;
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Noun for the "Showing X–Y of N opportunities" summary. */
  noun: string;
  onPageChange: (page: number) => void;
}

/**
 * Responsive pagination bar: a summary line plus Previous / numbered pages
 * (with ellipses) / Next. Page numbers are clickable buttons; the current page
 * is highlighted and disabled.
 */
export function Pagination({ page, pageSize, total, noun, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  if (total === 0) return null;

  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);
  const tokens = paginationRange(current, totalPages);

  const go = (p: number) => {
    const next = Math.min(Math.max(1, p), totalPages);
    if (next !== current) onPageChange(next);
  };

  const navBtn =
    'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-navy transition-colors hover:border-cyan disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav
      className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
      aria-label="Pagination"
    >
      <p className="text-sm text-slate-500" aria-live="polite" data-testid="pagination-summary">
        Showing{' '}
        <span className="font-medium text-navy">
          {start.toLocaleString()}–{end.toLocaleString()}
        </span>{' '}
        of <span className="font-medium text-navy">{total.toLocaleString()}</span> {noun}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={navBtn}
          onClick={() => go(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </button>

        {tokens.map((t, i) =>
          t === 'ellipsis' ? (
            <span key={`e${i}`} className="px-1.5 text-slate-400" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={t}
              type="button"
              onClick={() => go(t)}
              aria-label={`Page ${t}`}
              aria-current={t === current ? 'page' : undefined}
              disabled={t === current}
              className={cn(
                'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-medium transition-colors',
                t === current
                  ? 'border-navy bg-navy text-white'
                  : 'border-slate-200 bg-white text-navy hover:border-cyan',
              )}
            >
              {t}
            </button>
          ),
        )}

        <button
          type="button"
          className={navBtn}
          onClick={() => go(current + 1)}
          disabled={current >= totalPages}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
