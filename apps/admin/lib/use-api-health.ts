'use client';

import { useSyncExternalStore } from 'react';
import { api } from './api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const POLL_MS = 30_000;
const TIMEOUT_MS = 8_000;

/** What the API reports about itself to a Super Admin (fixed sentences only; see HealthService in the API). */
export interface SystemHealth {
  status: 'ok' | 'degraded';
  checkedAt: string;
  uptimeSeconds: number;
  checks: Array<{ name: string; status: 'ok' | 'down'; latencyMs: number; message: string }>;
}

export interface ApiHealthState {
  /** loading: no answer yet. healthy / degraded: the API answered. unavailable: it could not be reached or could not tell us. */
  state: 'loading' | 'healthy' | 'degraded' | 'unavailable';
  details: SystemHealth | null;
  /** When the last check finished (our clock), whatever its outcome. */
  lastCheckedAt: Date | null;
  /** How long the whole check took, in ms. */
  responseMs: number | null;
  /** A plain-words reason when the state is degraded or unavailable. Never a raw error message. */
  problem: string | null;
  checking: boolean;
}

const initial: ApiHealthState = { state: 'loading', details: null, lastCheckedAt: null, responseMs: null, problem: null, checking: false };
let snapshot: ApiHealthState = initial;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

function publish(next: Partial<ApiHealthState>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    work.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** When the detailed check fails, the public probe tells "the API is up but its database is not" from "the API cannot be reached". */
async function diagnose(): Promise<string> {
  try {
    const res = await withTimeout(fetch(`${API_URL}/health`, { cache: 'no-store' }));
    if (res.ok) return 'The API is running but could not return its status. Try again in a moment.';
    return 'The API is running but its database is not answering.';
  } catch {
    return 'The API cannot be reached. It may be down, restarting, or your connection is offline.';
  }
}

export async function checkApiHealth(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  publish({ checking: true });
  const started = Date.now();
  try {
    const details = await withTimeout(api.get<SystemHealth>('/admin/system/health'));
    const degraded = details.status !== 'ok';
    publish({
      state: degraded ? 'degraded' : 'healthy',
      details,
      problem: degraded ? (details.checks.find((c) => c.status !== 'ok')?.message ?? 'A part of the system is not working.') : null,
    });
  } catch {
    publish({ state: 'unavailable', details: null, problem: await diagnose() });
  } finally {
    inFlight = false;
    publish({ checking: false, lastCheckedAt: new Date(), responseMs: Date.now() - started });
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') void checkApiHealth();
}

function start() {
  void checkApiHealth();
  timer = setInterval(() => {
    // A hidden tab does not need a fresh answer; it is refreshed the moment the tab is shown again.
    if (document.visibilityState === 'visible') void checkApiHealth();
  }, POLL_MS);
  document.addEventListener('visibilitychange', onVisibility);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

/** The API's health, shared by everything on the page: one poll every 30 s however many parts of the page show it. */
export function useApiHealth(): ApiHealthState & { refresh: () => void } {
  const s = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => initial,
  );
  return { ...s, refresh: () => void checkApiHealth() };
}
