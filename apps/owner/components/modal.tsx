'use client';

import { useEffect, useRef } from 'react';
import { useDialogKeys } from '@/components/use-dialog-keys';

/**
 * A content modal (forms and the like). Mount it to open it, unmount it to close it.
 * Esc and a click on the backdrop close it (unless `busy`), Tab stays inside, the page
 * behind does not scroll, and focus returns to whatever opened it.
 */
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogKeys(panel, onClose, busy);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current
      ?.querySelector<HTMLElement>('input, select, textarea, button:not([data-modal-close])')
      ?.focus();
    return () => {
      document.body.style.overflow = scrollLock;
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl animate-[rise_0.2s_ease-out_both] flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl ring-1 ring-outline-variant/30"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant/20 px-6 py-4">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-on-surface">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-body-md text-on-surface-variant">{subtitle}</p>}
          </div>
          <button
            type="button"
            data-modal-close
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
