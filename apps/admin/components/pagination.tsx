'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';

/** The "1–25 of 169 · Page 1 of 7" bar under a table. Renders nothing when everything fits on one page. */
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
      className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/50 px-4 py-3 text-sm"
    >
      <span className="text-gray-500">
        {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="px-3 py-1.5" disabled={current <= 1} onClick={() => onPage(current - 1)}>
          Previous
        </Button>
        <span className="hidden text-gray-500 sm:inline">
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

/**
 * Client-side paging for lists that are loaded in full. `resetKey` should
 * change whenever the visible set changes (search, filters, sort) so paging
 * restarts at page 1.
 */
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
