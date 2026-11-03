'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

export const PAGE_SIZE = 25;

interface PagedState<T> {
  rows: T[];
  total: number;
  error: string | null;
  loading: boolean;
  refetch: () => void;
  /** Changes the rows on screen right now, with no request (for optimistic updates); `totalDelta` moves the count with them. */
  mutateRows: (updater: (rows: T[]) => T[], totalDelta?: number) => void;
}

/**
 * Server-side paging for list endpoints that take ?limit=&offset= and report
 * the match count in X-Total-Count. `query` is the filter part of the URL
 * (no leading "?", e.g. "status=CONFIRMED"); changing it, `page` or
 * `pageSize` refetches. A stale response from an earlier request can never
 * overwrite a newer one.
 */
export function usePagedFetch<T>(
  basePath: string,
  query: string,
  page: number,
  pageSize: number = PAGE_SIZE,
): PagedState<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const mutateRows = useCallback((updater: (rows: T[]) => T[], totalDelta = 0) => {
    setRows((current) => updater(current));
    if (totalDelta !== 0) setTotal((n) => Math.max(0, n + totalDelta));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = [query, `limit=${pageSize}`, `offset=${(Math.max(page, 1) - 1) * pageSize}`]
      .filter(Boolean)
      .join('&');
    api
      .getPage<T>(`${basePath}?${qs}`)
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, query, page, pageSize, tick]);

  return { rows, total, error, loading, refetch, mutateRows };
}
