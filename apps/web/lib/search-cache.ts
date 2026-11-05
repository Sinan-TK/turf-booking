/**
 * The last few venue searches (and the venue pages opened from them), kept for this browser tab so a repeat visit paints cards at once while the live answer is fetched
 * (stale-while-revalidate). Only a head start: the page always asks the API again and replaces what it showed, and the API
 * re-checks every slot when it is held, so a stale card can never book something that is gone.
 *
 * sessionStorage on purpose, not localStorage: it ends with the tab, so a morning's slots are never shown the next day, and nothing
 * lingers on a shared device. A search is public data, with nothing about the person in it.
 */
const KEY = 'bookyo.search.v1';
const MAX_AGE_MS = 10 * 60_000;
const MAX_ENTRIES = 16; // the listing's searches and the venue pages opened from them

export interface CachedSearch<T> {
  at: number;
  data: T[];
  nextCursor: string | null;
  advanceDays: number | null;
}

type Store<T> = Record<string, CachedSearch<T>>;

function load<T>(): Store<T> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store<T>) : {};
  } catch {
    return {};
  }
}

/** The saved answer for this exact search, if it is recent enough to be worth showing first. */
export function readSearch<T>(path: string): CachedSearch<T> | null {
  const hit = load<T>()[path];
  return hit && Date.now() - hit.at < MAX_AGE_MS && Array.isArray(hit.data) ? hit : null;
}

export function writeSearch<T>(path: string, entry: Omit<CachedSearch<T>, 'at'>): void {
  try {
    const store = load<T>();
    store[path] = { ...entry, at: Date.now() };
    const newest = Object.entries(store)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_ENTRIES);
    window.sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(newest)));
  } catch {
    // Storage full or blocked (private window): the site works the same, just without the head start.
  }
}
