'use client';

/**
 * The card at the top of every list page: title, subtitle, primary action,
 * and (optionally) a toolbar row for search/filters. Keeps all list pages
 * looking and behaving the same.
 */
export function ListSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-xl border border-gray-200/80 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3">{children}</div>}
    </section>
  );
}

/** "Showing 12 of 169 · Clear filters" line under a toolbar. */
export function FilterSummary({
  shown,
  total,
  noun,
  onClear,
}: {
  shown: number;
  total: number;
  noun: string;
  onClear: () => void;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-3 text-sm" aria-live="polite">
      <span className="text-gray-500">
        Showing {shown} of {total} {noun}
      </span>
      <button type="button" onClick={onClear} className="font-medium text-brand-700 hover:underline">
        Clear filters
      </button>
    </div>
  );
}
