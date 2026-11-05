'use client';

import { useEffect, useRef } from 'react';

const SHOW_MS = 2600;
const SHOW_REDUCED_MS = 1200;

/**
 * The "payment successful" moment: a full-screen cover where a green ring draws itself and a tick strokes in (see `.pay-ring` and
 * `.pay-tick` in globals.css), with what was paid, and then the page moves on by itself (`onDone`, a few seconds later; at once on
 * the button). For people who asked for less motion there is no drawing and the wait is shorter.
 */
export function PaymentSuccess({
  title = 'Payment successful',
  amount,
  detail,
  continueLabel = 'View booking',
  onDone,
}: {
  title?: string;
  /** "₹800" */
  amount: string;
  /** "Paid online", "Paid with Coins", ... */
  detail: string;
  continueLabel?: string;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = setTimeout(() => done.current(), reduced ? SHOW_REDUCED_MS : SHOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={title}
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-6 bg-cream px-6 text-center"
    >
      <svg width="132" height="132" viewBox="0 0 132 132" fill="none" aria-hidden="true">
        <circle cx="66" cy="66" r="60" fill="#A5F52B" className="pay-fill" />
        <circle cx="66" cy="66" r="60" stroke="#050505" strokeWidth="5" strokeLinecap="round" className="pay-ring" />
        <path d="M40 68 L58 86 L94 48" stroke="#050505" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" className="pay-tick" />
      </svg>
      <div className="pay-text space-y-1.5">
        <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
        <p className="text-3xl font-black text-slate-900">{amount}</p>
        <p className="text-sm font-medium text-slate-500">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onDone}
        className="pay-text rounded-xl bg-brand-700 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-800 active:scale-95"
      >
        {continueLabel}
      </button>
      <p className="pay-text text-xs text-slate-400">Taking you there…</p>
    </div>
  );
}
