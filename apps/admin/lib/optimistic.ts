import { ApiError } from '@/lib/api';

/** The `mutate` of useFetch: change what is on screen right now, with no request. */
export type Mutate<T> = (updater: (prev: T | null) => T | null) => void;

/**
 * Optimistic update: the change shows on screen at once, the request is sent, and if the server refuses (or cannot be reached) the screen
 * goes back to how it was and `onFail` gets a message. Answers whether the change stuck. Use it for actions that nearly always succeed
 * (a switch, a status, a removal); anything the server may well refuse with a reason (a form with rules) waits for the answer instead.
 */
export async function optimistic<T>(
  mutate: Mutate<T>,
  update: (prev: T) => T,
  request: () => Promise<unknown>,
  onFail: (message: string) => void,
): Promise<boolean> {
  let before: T | null = null;
  mutate((prev) => {
    before = prev;
    return prev ? update(prev) : prev;
  });
  try {
    await request();
    return true;
  } catch (err) {
    const snapshot = before;
    mutate(() => snapshot);
    onFail(err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.');
    return false;
  }
}

/** The same for a paged list: `mutateRows` of usePagedFetch. `totalDelta` is how the match count moves (-1 for a removal). */
export async function optimisticRows<T>(
  mutateRows: (updater: (rows: T[]) => T[], totalDelta?: number) => void,
  update: (rows: T[]) => T[],
  totalDelta: number,
  request: () => Promise<unknown>,
  onFail: (message: string) => void,
): Promise<boolean> {
  let before: T[] | null = null;
  mutateRows((rows) => {
    before = rows;
    return update(rows);
  }, totalDelta);
  try {
    await request();
    return true;
  } catch (err) {
    const snapshot = before;
    if (snapshot) mutateRows(() => snapshot, -totalDelta);
    onFail(err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.');
    return false;
  }
}
