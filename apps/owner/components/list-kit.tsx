'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SvgIcon } from '@/components/svg-icons';
import { Button, Card, EmptyState } from '@/components/ui';

/** Search box that reports the typed text only after a pause in typing. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The last text this box reported to its parent (or received from it).
  const reported = useRef(value.trim());

  // The parent changed the value from outside (e.g. "Clear filters"): show it, and drop any
  // pending report of older typing so it cannot undo the reset.
  useEffect(() => {
    if (value.trim() === reported.current) return;
    reported.current = value.trim();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setText(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Enter reports any pending text right away. (Not on blur: that re-rendered the list under a click on a
  // result link and the click was lost.)
  function flush() {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    reported.current = text.trim();
    onChange(text.trim());
  }

  // Report the typed text only after a pause in typing.
  function onInput(next: string) {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null; // nothing is pending any more, so a later blur must not report again
      reported.current = next.trim();
      onChange(next.trim());
    }, 300);
  }

  return (
    <div className="relative min-w-[12rem] flex-1 basis-full lg:basis-0">
      <SvgIcon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
      />
      <input
        type="search"
        value={text}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && flush()}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest pl-9 pr-3 text-body-md text-on-surface transition-colors placeholder:text-on-surface-variant/60 hover:border-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

const chip = (active: boolean) =>
  `inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-body-md transition-colors ${
    active
      ? 'border-primary/50 bg-primary-fixed-dim/15'
      : 'border-outline-variant/40 bg-surface-container-lowest hover:border-outline'
  }`;

/** A labelled dropdown that highlights itself while it is filtering. */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className={chip(value !== options[0]?.value)}>
      <span className="text-on-surface-variant">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="max-w-[11rem] cursor-pointer bg-transparent font-medium text-on-surface focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** "From [date] to [date]"; values are YYYY-MM-DD, blank means open-ended. */
export function DateRangeFilter({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className={chip(from !== '' || to !== '')}>
      <span className="text-on-surface-variant">{label}</span>
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFrom(e.target.value)}
        aria-label={`${label} from`}
        className="bg-transparent font-medium text-on-surface focus:outline-none"
      />
      <span className="text-on-surface-variant">–</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onTo(e.target.value)}
        aria-label={`${label} to`}
        className="bg-transparent font-medium text-on-surface focus:outline-none"
      />
    </div>
  );
}

/** Search + filter row, with the "N matches · Clear filters" line once a filter is on. */
export function ListToolbar({
  search,
  children,
  active,
  total,
  noun,
  onClear,
}: {
  search: React.ReactNode;
  children?: React.ReactNode;
  active: boolean;
  total: number;
  noun: string;
  onClear: () => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        {search}
        {children}
      </div>
      {active && (
        <div className="mt-2.5 flex items-center gap-3 text-body-md" aria-live="polite">
          <span className="text-on-surface-variant">
            {total} {noun}
            {total === 1 ? '' : 's'} match
          </span>
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}

/** The "1–20 of 169 · Page 1 of 9" bar under a table. Renders nothing when everything fits on one page. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const current = Math.min(page, pageCount);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-outline-variant/20 bg-surface-container-low px-4 py-3 text-body-md"
    >
      <span className="text-on-surface-variant">
        {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          disabled={current <= 1}
          onClick={() => onPage(current - 1)}
        >
          Previous
        </Button>
        <span className="hidden text-on-surface-variant sm:inline">
          Page {current} of {pageCount}
        </span>
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          disabled={current >= pageCount}
          onClick={() => onPage(current + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Client-side paging for lists that are loaded in full; `resetKey` restarts at page 1 when the visible set changes. */
export function usePageSlice<T>(items: T[], pageSize: number, resetKey: unknown) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const rows = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );
  return { rows, page: current, setPage, total: items.length };
}

export const TH = 'px-4 py-3 font-medium';

/**
 * Table card used by every list: header row, body, pagination footer. While a
 * new page loads the old rows stay (dimmed) so the table doesn't jump.
 */
export function DataTable({
  columns,
  loading,
  empty,
  children,
  footer,
  rowCount,
}: {
  columns: Array<string | { label: string; className?: string }>;
  loading: boolean;
  /** Message when there are no rows and nothing is loading. */
  empty: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  rowCount: number;
}) {
  if (!loading && rowCount === 0) return <EmptyState message={empty} />;
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-outline-variant/30 bg-surface-container-low text-xs uppercase tracking-wide text-on-surface-variant">
            <tr>
              {columns.map((c, i) => {
                const col = typeof c === 'string' ? { label: c } : c;
                return (
                  <th key={i} className={`${TH} ${col.className ?? ''}`}>
                    {col.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={`transition-opacity ${loading && rowCount > 0 ? 'opacity-50' : ''}`}>
            {rowCount === 0
              ? Array.from({ length: 6 }, (_, r) => (
                  <tr key={r} className="border-b border-outline-variant/20">
                    {columns.map((_c, i) => (
                      <td key={i} className="px-4 py-3.5">
                        <div className="h-4 animate-pulse rounded bg-surface-container-high" />
                      </td>
                    ))}
                  </tr>
                ))
              : children}
          </tbody>
        </table>
      </div>
      {footer}
    </Card>
  );
}

export const ROW =
  'border-b border-outline-variant/20 last:border-0 transition-colors hover:bg-surface-container-low/60';
