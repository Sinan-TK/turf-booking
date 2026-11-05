'use client';

import { useEffect } from 'react';

/** Starts the service worker (installable app, offline page). Production only: in development it would keep stale files around. */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
