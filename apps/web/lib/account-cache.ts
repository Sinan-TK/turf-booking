'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';

/**
 * The customer's own pages (bookings, saved venues, wallet) kept for this browser tab, so a repeat visit paints the last answer
 * at once while the live one is fetched (stale-while-revalidate): the page always asks the API again and replaces what it showed.
 *
 * sessionStorage, not localStorage: it ends with the tab, and logging out clears it, so nothing personal lingers on a shared
 * device. Every entry is keyed by the customer's id, so one person's lists can never be shown to another.
 */
const KEY = 'bookyo.account.v1';
const MAX_AGE_MS = 30 * 60_000;

interface Entry {
  at: number;
  data: unknown;
}

/** What is kept, minus anything older than it is allowed to be (so old personal data is dropped, not just ignored). */
function load(): Record<string, Entry> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
    return Object.fromEntries(Object.entries(all).filter(([, e]) => Date.now() - e.at < MAX_AGE_MS));
  } catch {
    return {};
  }
}

function read<T>(key: string): T | null {
  const hit = load()[key];
  return hit && Date.now() - hit.at < MAX_AGE_MS ? (hit.data as T) : null;
}

function write(key: string, data: unknown): void {
  try {
    const store = load();
    store[key] = { at: Date.now(), data };
    window.sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked (private window): the pages work the same, just without the head start.
  }
}

/** Forget one kept list (it changed somewhere else), so the next visit to it waits for the live answer instead of showing the old one. */
export function forgetAccountData(customerId: string, name: string): void {
  try {
    const store = load();
    delete store[`${customerId}:${name}`];
    window.sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // nothing to forget
  }
}

/** Forget everything kept for the account pages (on log out). */
export function clearAccountCache(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * One of the account pages' lists. `data` starts as the last saved answer (if any) and is replaced by the live one; `setData`
 * changes what is shown (and what is kept) right away, for instant updates. An expired session sends the visitor to the login
 * prompt; any other failure is `error`, unless there is an older answer on screen to keep showing.
 */
export function useAccountData<T>(name: string, fetcher: () => Promise<T>, failMessage: string) {
  const { customer, refresh } = useCustomer();
  const key = customer ? `${customer.id}:${name}` : null;
  const [data, setDataState] = useState<T | null>(() => (key ? read<T>(key) : null));
  const [error, setError] = useState<string | null>(null);
  // A different person (or none) is now signed in: what was shown belongs to the previous key, so start again from this key's own.
  const shownKey = useRef(key);
  if (shownKey.current !== key) {
    shownKey.current = key;
    setDataState(key ? read<T>(key) : null);
    setError(null);
  }
  const latest = useRef({ fetcher, failMessage });
  latest.current = { fetcher, failMessage };

  useEffect(() => {
    if (!key) return;
    let live = true;
    latest.current
      .fetcher()
      .then((fresh) => {
        if (!live) return;
        write(key, fresh);
        setDataState(fresh);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 401) {
          clearAccountCache(); // the session is gone: nothing of theirs stays
          return void refresh();
        }
        if (read(key) === null) setError(err instanceof ApiError ? err.message : latest.current.failMessage);
      });
    return () => {
      live = false;
    };
  }, [key, refresh]);

  const setData = useCallback(
    (next: T | null | ((current: T | null) => T | null)) => {
      setDataState((current) => {
        const value = typeof next === 'function' ? (next as (c: T | null) => T | null)(current) : next;
        if (key && value !== null) write(key, value);
        return value;
      });
    },
    [key],
  );

  return { data, setData, error };
}
