import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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
 * Sticky results pager. Previous / Next step one page. The number box jumps
 * to an exact page. The slider scrubs across the whole result set without
 * listing dozens of page buttons.
 */
export function Pagination({ page, pageSize, total, noun, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const [draft, setDraft] = useState(String(current));
  const [slider, setSlider] = useState(current);

  useEffect(() => {
    setDraft(String(current));
    setSlider(current);
  }, [current]);

  if (total === 0) return null;

  const start = (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);

  const go = (p: number) => {
    if (!Number.isFinite(p)) return;
    const next = Math.min(Math.max(1, Math.trunc(p)), totalPages);
    setDraft(String(next));
    setSlider(next);
    if (next !== current) onPageChange(next);
  };

  const navBtn =
    'inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-navy transition-colors hover:border-cyan disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav
      className="sticky top-20 z-20 mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur"
      aria-label="Pagination"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500" aria-live="polite" data-testid="pagination-summary">
          Showing{' '}
          <span className="font-medium text-navy">
            {start.toLocaleString()}–{end.toLocaleString()}
          </span>{' '}
          of <span className="font-medium text-navy">{total.toLocaleString()}</span> {noun}
        </p>

        <div className="flex items-center gap-1.5">
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

          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <span className="sr-only">Go to page</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={draft}
              aria-label="Go to page"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => go(Number(draft))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  go(Number(draft));
                }
              }}
              className="h-9 w-16 rounded-lg border border-slate-200 px-2 text-center text-sm font-medium text-navy outline-none focus:border-cyan"
            />
            <span>of {totalPages.toLocaleString()}</span>
          </label>

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
      </div>

      {totalPages > 1 && (
        <input
          type="range"
          min={1}
          max={totalPages}
          step={1}
          value={slider}
          aria-label="Page slider"
          aria-valuetext={`Page ${slider} of ${totalPages}`}
          onChange={(event) => {
            const next = Number(event.target.value);
            setSlider(next);
            setDraft(String(next));
          }}
          onPointerUp={(event) => go(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              go(Number(event.currentTarget.value));
            }
          }}
          className="h-2 w-full cursor-pointer accent-navy"
        />
      )}
    </nav>
  );
}