'use client';

import { useEffect, useRef, useState } from 'react';
import { useDialogKeys } from '@/components/use-dialog-keys';
import { SvgIcon } from '@/components/svg-icons';
import { ErrorBanner } from '@/components/ui';

type Tone = 'primary' | 'warn' | 'danger';

const TONES: Record<Tone, { icon: string; button: string }> = {
  primary: {
    icon: 'bg-emerald-100 text-emerald-700',
    button: 'bg-primary text-on-primary hover:bg-primary/90',
  },
  warn: {
    icon: 'bg-amber-100 text-amber-700',
    button: 'bg-amber-600 text-white hover:bg-amber-700',
  },
  danger: { icon: 'bg-red-100 text-red-700', button: 'bg-error text-on-error hover:bg-error/90' },
};

/** How long the button has to be held. Long enough that a stray click can never do it, short enough not to feel like a chore. */
export const HOLD_MS = 1500;

/**
 * A button that only acts when it is held down for HOLD_MS: a bar fills while you hold, letting go early starts over. Works with
 * the mouse, touch and the keyboard (hold Space or Enter), and says so, since a plain click does nothing.
 */
function HoldButton({ label, busy, className, onComplete }: { label: string; busy: boolean; className: string; onComplete: () => void }) {
  const [progress, setProgress] = useState(0); // 0..1
  const [hint, setHint] = useState(false);
  const frame = useRef<number | null>(null);
  const startedAt = useRef<number | null>(null);
  const done = useRef(false);

  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    startedAt.current = null;
    setProgress(0);
  };
  const tick = () => {
    if (startedAt.current === null) return;
    const p = Math.min(1, (performance.now() - startedAt.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      if (!done.current) {
        done.current = true;
        onComplete();
      }
      stop();
      return;
    }
    frame.current = requestAnimationFrame(tick);
  };
  const start = () => {
    if (busy || startedAt.current !== null) return;
    done.current = false;
    setHint(false);
    startedAt.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  };
  const release = () => {
    if (startedAt.current !== null) setHint(true); // let go too early: remind them what to do
    stop();
  };
  useEffect(() => () => stop(), []);

  return (
    <div className="flex flex-col items-stretch sm:items-end">
      <button
        type="button"
        disabled={busy}
        aria-label={`${label}: press and hold for ${HOLD_MS / 1000} seconds`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          start();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            start();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') release();
        }}
        onBlur={release}
        className={`relative select-none overflow-hidden rounded-lg px-4 py-2 font-label-md text-label-md transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
        style={{ touchAction: 'none' }}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-black/25" style={{ width: `${progress * 100}%` }} />
        <span className="relative">{busy ? 'Working…' : progress > 0 ? 'Keep holding…' : `Hold to ${label.toLowerCase()}`}</span>
      </button>
      <p role="status" className="mt-1 h-4 text-xs text-on-surface-variant">
        {hint ? 'Keep holding the button until it fills.' : ''}
      </p>
    </div>
  );
}

/**
 * A confirmation modal. Mount it to open it, unmount it to close it. Esc and
 * a click on the backdrop cancel (unless a request is in flight), Tab stays
 * inside, focus starts on Cancel so Enter never confirms by accident, and
 * focus returns to whatever opened it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy = false,
  error,
  holdToConfirm = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  tone?: Tone;
  busy?: boolean;
  error?: string | null;
  /** For something that cannot be undone: the confirm button has to be held down (or held with Space / Enter) to count. */
  holdToConfirm?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogKeys(panel, onCancel, busy);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const t = TONES[tone];

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButton.current?.focus();
    return () => {
      document.body.style.overflow = scrollLock;
      opener?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md animate-[rise_0.2s_ease-out_both] rounded-2xl bg-surface-container-lowest p-6 shadow-xl ring-1 ring-outline-variant/30"
      >
        <div className="flex gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${t.icon}`}
          >
            <SvgIcon name={tone === 'primary' ? 'check' : 'warn'} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-semibold text-on-surface">
              {title}
            </h2>
            <div className="mt-1.5 space-y-2 text-body-md text-on-surface-variant">{children}</div>
          </div>
        </div>
        {error && (
          <div className="mt-4">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButton}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg px-4 py-2 font-label-md text-label-md text-on-surface ring-1 ring-outline-variant/50 transition-colors hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          {holdToConfirm ? (
            <HoldButton label={confirmLabel} busy={busy} className={t.button} onComplete={onConfirm} />
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={`rounded-lg px-4 py-2 font-label-md text-label-md transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${t.button}`}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
