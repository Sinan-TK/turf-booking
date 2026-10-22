'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Filter + page state for a server-filtered list. Changing any filter sends
 * the list back to page 1. `query` is ready for usePagedFetch: blank values
 * are dropped, and `from` / `to` (YYYY-MM-DD from a date input) become the
 * browser-local start of that day / start of the day after, so the API's
 * half-open [from, to) window includes the whole "to" day.
 */
export function useListFilters<T extends Record<string, string>>(initial: T) {
  const defaults = useRef(initial).current;
  const [values, setValues] = useState<T>(initial);
  const [page, setPage] = useState(1);

  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((cur) => ({ ...cur, [key]: value }));
    setPage(1);
  }, []);

  const clear = useCallback(() => {
    setValues(defaults);
    setPage(1);
  }, [defaults]);

  const active = (Object.keys(defaults) as Array<keyof T>).some((k) => values[k] !== defaults[k]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(values)) {
      const value = raw.trim();
      if (!value) continue;
      if (key === 'from') params.set(key, localDay(value, 0).toISOString());
      else if (key === 'to') params.set(key, localDay(value, 1).toISOString());
      else params.set(key, value);
    }
    return params.toString();
  }, [values]);

  return { values, set, clear, active, page, setPage, query };
}

function localDay(ymd: string, plusDays: number): Date {
  const [y = 0, m = 1, d = 1] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d + plusDays);
}
