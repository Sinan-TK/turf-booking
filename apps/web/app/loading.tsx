import { Logo } from '@/components/logo';

/** Shown by Next while a page is on its way: the Bookyo logo breathes and a lime bar sweeps beneath it. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[70vh] flex-col items-center justify-center gap-8 bg-cream px-6">
      <Logo hole="#FFFCF6" className="loader-breathe h-20 w-auto select-none sm:h-28" />
      <div aria-hidden="true" className="h-1.5 w-44 overflow-hidden rounded-full bg-slate-200">
        <div className="loader-sweep h-full w-1/3 rounded-full bg-brand-400" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
