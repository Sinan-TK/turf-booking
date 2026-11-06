'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** What the Super Admin has switched on for the public site. */
export interface SiteConfig {
  googleSignIn: boolean;
}

const MAX_AGE_MS = 60_000;
let kept: { at: number; value: SiteConfig } | null = null;
let inFlight: Promise<SiteConfig> | null = null;

function fetchConfig(): Promise<SiteConfig> {
  if (kept && Date.now() - kept.at < MAX_AGE_MS) return Promise.resolve(kept.value);
  inFlight ??= api
    .get<SiteConfig>('/site/config')
    .then((value) => {
      kept = { at: Date.now(), value };
      return value;
    })
    // If it cannot be read, nothing optional is offered: Google stays hidden.
    .catch(() => ({ googleSignIn: false }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** The site's switches, or null until they have been read (a minute's answer is kept, so opening the login box again is instant). */
export function useSiteConfig(): SiteConfig | null {
  const [config, setConfig] = useState<SiteConfig | null>(kept && Date.now() - kept.at < MAX_AGE_MS ? kept.value : null);
  useEffect(() => {
    let cancelled = false;
    void fetchConfig().then((v) => !cancelled && setConfig(v));
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
