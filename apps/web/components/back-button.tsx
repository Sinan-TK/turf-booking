'use client';

import { useRouter } from 'next/navigation';

/**
 * A back button in a rounded square (or, plain, just the arrow, for a nav bar). It goes back to the page the visitor came from, or to the home page when the page was
 * opened directly (a link, a refresh in a new tab) and there is nowhere to go back to.
 */
export function BackButton({ label = 'Go back', plain = false }: { label?: string; plain?: boolean }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
      className={`flex h-10 w-10 items-center justify-center text-slate-700 ${plain ? '-ml-2' : 'rounded-xl border border-slate-200 bg-white shadow-sm transition hover:bg-slate-50 active:scale-95'}`}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
