'use client';

import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/**
 * Which column a server-sorted table is sorted by, and which way. Clicking a column sorts by it (dates, money and order numbers start
 * with the newest or biggest, text columns from A); clicking it again flips the direction. `query` is ready to add to the list's request.
 * `onChange` is for sending the list back to its first page.
 */
export function useSort<K extends string>(initial: { key: K; dir: SortDir }, firstDir: Partial<Record<K, SortDir>> = {}, onChange?: () => void) {
  const [sort, setSort] = useState(initial);
  const toggle = useCallback(
    (key: K) => {
      setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir[key] ?? 'asc' }));
      onChange?.();
    },
    [onChange],
  );
  const query = useMemo(() => `sort=${sort.key}&dir=${sort.dir}`, [sort]);
  return { sort, toggle, query };
}

/** Adds a sort query to a list's other filters. */
export const withSort = (filters: string, sortQuery: string) => (filters ? `${filters}&${sortQuery}` : sortQuery);
