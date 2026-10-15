'use client';

import { useEffect } from 'react';
import { useFetch } from './use-fetch';

const POLL_INTERVAL_MS = 30_000;

/**
 * No realtime delivery exists in this project (no realtime transport is
 * configured anywhere — see NotificationsService's own doc comment), so
 * the unread badge polls instead. This is the first polling code in
 * this app — deliberately scoped to just this one hook rather than a
 * general-purpose polling utility, since nothing else needs it yet.
 */
export function useUnreadNotificationCount() {
  const { data, refetch, mutate } = useFetch<{ count: number }>('/owner/notifications/unread-count');

  useEffect(() => {
    const id = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  return { count: data?.count ?? 0, refetch, mutate };
}
