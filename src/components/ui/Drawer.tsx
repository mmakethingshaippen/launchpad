import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

/**
 * Accessible slide-in drawer (used for the mobile filter panel, Req 6.7).
 * Dismissible via Escape and overlay click; labelled for screen readers.
 * (A Radix Dialog can be swapped in later without changing call sites.)
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'left',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  side?: 'left' | 'right';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="absolute inset-0 bg-navy/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={
          'absolute top-0 h-full w-[85%] max-w-sm overflow-y-auto bg-white p-4 shadow-xl ' +
          (side === 'left' ? 'left-0' : 'right-0')
        }
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close filters">
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
