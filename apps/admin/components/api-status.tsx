'use client';

import { useEffect, useState } from 'react';
import { Card } from './ui';
import { useApiHealth, type ApiHealthState } from '../lib/use-api-health';

const LOOK: Record<ApiHealthState['state'], { label: string; dot: string; ring: string }> = {
  loading: { label: 'Checking…', dot: 'bg-gray-400 animate-pulse', ring: 'bg-gray-100 text-gray-600 ring-gray-500/20' },
  healthy: { label: 'Healthy', dot: 'bg-emerald-500', ring: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', ring: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
  unavailable: { label: 'Unavailable', dot: 'bg-red-500', ring: 'bg-red-50 text-red-700 ring-red-600/20' },
};

/** "12 s ago" that keeps itself current. */
function useAgo(date: Date | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5_000);
    return () => clearInterval(t);
  }, []);
  if (!date) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

function uptime(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}

/** A small coloured dot with the status, for the sidebar. On the collapsed rail it is just the dot. */
export function ApiStatusPill({ expanded }: { expanded: boolean }) {
  const h = useApiHealth();
  const look = LOOK[h.state];
  const ago = useAgo(h.lastCheckedAt);
  const label = h.state === 'loading' ? 'Checking API…' : `API ${look.label.toLowerCase()}`;
  const text = `${label}${h.lastCheckedAt ? ` · checked ${ago}` : ''}`;
  return (
    <a
      href="/dashboard#system-status"
      title={h.problem ? `${text}. ${h.problem}` : text}
      aria-label={text}
      data-testid="api-status-pill"
      data-state={h.state}
      className="flex items-center gap-3 rounded-lg px-[15px] py-2 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-gray-100"
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        <span className={`h-2.5 w-2.5 rounded-full ${look.dot}`} />
      </span>
      <span className={`whitespace-nowrap md:transition-opacity md:duration-150 ${expanded ? 'md:opacity-100' : 'md:opacity-0'}`}>{label}</span>
    </a>
  );
}

/** The dashboard's status card: the state, when it was last checked, how fast it answered, and each check. */
export function SystemStatusCard() {
  const h = useApiHealth();
  const look = LOOK[h.state];
  const ago = useAgo(h.lastCheckedAt);
  return (
    <Card>
      <div id="system-status" data-testid="system-status" data-state={h.state}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900">API status</h2>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${look.ring}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} />
              {look.label}
            </span>
          </div>
          <button
            onClick={h.refresh}
            disabled={h.checking}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            {h.checking ? 'Checking…' : 'Check now'}
          </button>
        </div>

        {h.problem && (
          <p role="alert" className={`mt-3 rounded-lg px-3 py-2 text-sm ${h.state === 'unavailable' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
            {h.problem}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-500">Last checked</dt>
            <dd className="font-medium text-gray-900" title={h.lastCheckedAt?.toLocaleString()}>
              {ago}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Check took</dt>
            <dd className="font-medium text-gray-900">{h.responseMs === null ? '—' : `${h.responseMs} ms`}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Running for</dt>
            <dd className="font-medium text-gray-900">{h.details ? uptime(h.details.uptimeSeconds) : '—'}</dd>
          </div>
        </dl>

        {h.details && (
          <ul className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
            {h.details.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-gray-900">
                  <span className={`h-2 w-2 rounded-full ${c.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {c.name}
                </span>
                <span className="text-right text-xs text-gray-500">
                  {c.message} {c.status === 'ok' ? `(${c.latencyMs} ms)` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-gray-400">Refreshes every 30 seconds while this tab is open.</p>
      </div>
    </Card>
  );
}
