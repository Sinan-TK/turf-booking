'use client';

/**
 * The bar that offers "Save" once something on a page has changed: fixed along the bottom of the window, the full width of
 * the page beside the sidebar rail, in the sidebar's own colour. A spacer keeps the last fields from hiding behind it.
 */
export function SaveBar({ message, tone = 'info', children }: { message?: string; tone?: 'info' | 'error'; children: React.ReactNode }) {
  return (
    <>
      <div className="h-20" aria-hidden="true" />
      <div
        role="region"
        aria-label="Unsaved changes"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-end gap-3 border-t border-white/10 bg-gray-900 px-4 py-3 shadow-pop sm:px-6 md:left-[72px] lg:px-8"
      >
        {message && <p className={`mr-auto text-sm ${tone === 'error' ? 'text-red-300' : 'text-gray-300'}`}>{message}</p>}
        {children}
      </div>
    </>
  );
}
