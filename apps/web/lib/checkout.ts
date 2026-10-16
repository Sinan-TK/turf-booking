import { useEffect, useRef, useState } from 'react';

/** "6:00 AM – 7:00 AM" — the end time customers actually need to know
 * before booking, not just when the slot starts. */
export function formatTimeRange(startIso: string, durationMinutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** "Fri, 26 Sep" for a booking's start. */
export function formatDay(startIso: string): string {
  return new Date(startIso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * mm:ss countdown to `expiresAtIso`, ticking every second, calling
 * `onExpire` once when it reaches zero. Pass null to stop it; a new
 * `expiresAtIso` starts a fresh countdown.
 */
export function useCountdown(expiresAtIso: string | null, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!expiresAtIso) {
      setSecondsLeft(null);
      return;
    }
    const target = new Date(expiresAtIso).getTime();
    let fired = false;

    const tick = () => {
      const remaining = Math.max(0, Math.round((target - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !fired) {
        fired = true;
        onExpireRef.current();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAtIso]);

  return secondsLeft;
}
