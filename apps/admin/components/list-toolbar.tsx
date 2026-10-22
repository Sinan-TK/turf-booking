'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Input } from '@/components/ui';

/** Search box that reports the typed text to the server-filtered list only after a pause in typing. */
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
      <Icon
        name="search"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
      />
      <Input
        type="search"
        value={text}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && flush()}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 pl-9"
      />
    </div>
  );
}

/** "From [date] to [date]" pair; values are YYYY-MM-DD, blank means open-ended. */
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
  const filtered = from !== '' || to !== '';
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border bg-white px-3 text-sm shadow-sm ${
        filtered ? 'border-brand-400 bg-brand-50/50' : 'border-gray-300'
      }`}
    >
      <span className="text-gray-500">{label}</span>
      <input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => onFrom(e.target.value)}
        aria-label={`${label} from`}
        className="bg-transparent font-medium text-gray-900 focus:outline-none"
      />
      <span className="text-gray-400">–</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => onTo(e.target.value)}
        aria-label={`${label} to`}
        className="bg-transparent font-medium text-gray-900 focus:outline-none"
      />
    </div>
  );
}

/** Search + dropdown row, with the "N matches · Clear filters" line under it once a filter is on. */
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
    <>
      <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
        {search}
        {children}
      </div>
      {active && (
        <div className="mt-2.5 flex items-center gap-3 text-sm" aria-live="polite">
          <span className="text-gray-500">
            {total} {noun}
            {total === 1 ? '' : 's'} match
          </span>
          <button
            type="button"
            onClick={onClear}
            className="font-medium text-brand-700 hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
