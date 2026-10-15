'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
  /** Updates the local cache immediately, with no network call — for
   * optimistic UI: apply the expected result the instant an action is
   * taken, then let the real request confirm or (via the caller's own
   * catch block, calling mutate() again with the previous value) roll
   * it back. */
  mutate: (updater: (prev: T | null) => T | null) => void;
}

/** Client-side GET with a manual refetch — deliberately no caching layer
 * (react-query, SWR): the admin portal's data changes from admin actions
 * within the same page far more often than it needs background revalidation,
 * so an explicit refetch() after a mutation is simpler and more predictable. */
export function useFetch<T>(path: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const mutate = useCallback((updater: (prev: T | null) => T | null) => {
    setData((prev) => updater(prev));
  }, []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Something went wrong');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, error, loading, refetch, mutate };
}
