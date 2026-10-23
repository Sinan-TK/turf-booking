'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input, Label } from '@/components/ui';

/** Just the part of Google's sign-in library this uses. */
interface GoogleAccounts {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void; cancel_on_tap_outside?: boolean }): void;
      renderButton(
        parent: HTMLElement,
        options: { type?: string; theme?: string; size?: string; text?: string; shape?: string; width?: number; logo_alignment?: string },
      ): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleAccounts;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
/** Development and test only: a plain form stands in for Google, and the API's fake verifier accepts it. */
const FAKE = process.env.NEXT_PUBLIC_GOOGLE_AUTH_MODE === 'fake';
const SCRIPT = 'https://accounts.google.com/gsi/client';

let scriptPromise: Promise<void> | undefined;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = undefined; // let a later attempt try again
      reject(new Error('load failed'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * "Continue with Google". Google's own button returns a signed ID token (`onCredential`), which the API verifies;
 * nothing else of Google's reaches this site. In fake mode (development and tests) a small labelled form creates
 * the stand-in token instead.
 */
export function GoogleButton({ onCredential, disabled = false }: { onCredential: (credential: string) => void; disabled?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [problem, setProblem] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (FAKE || !CLIENT_ID) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => callback.current(response.credential),
          cancel_on_tap_outside: true,
        });
        holder.current.replaceChildren();
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'pill',
          width: Math.min(320, Math.max(200, holder.current.offsetWidth || 320)),
        });
      })
      .catch(() => !cancelled && setProblem("Couldn't load Google sign-in. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (FAKE) {
    return (
      <form
        className="space-y-2 rounded-xl border border-dashed border-amber-400 bg-amber-50 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && email.trim()) onCredential(`test:${email.trim()}${name.trim() ? `|${name.trim()}` : ''}`);
        }}
      >
        <p className="text-xs font-semibold text-amber-800">Test sign-in (development only, not Google)</p>
        <div>
          <Label htmlFor="test-google-email">Test Google email</Label>
          <Input id="test-google-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="test-google-name">Test Google name</Label>
          <Input id="test-google-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={disabled || !email.trim()}>
          Continue with Google (test)
        </Button>
      </form>
    );
  }

  if (!CLIENT_ID) {
    return <p className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">Google sign-in isn&apos;t set up yet.</p>;
  }

  return (
    <div>
      <div ref={holder} className={`flex min-h-[44px] justify-center ${disabled ? 'pointer-events-none opacity-60' : ''}`} />
      {problem && (
        <p role="alert" className="mt-2 text-center text-xs text-red-600">
          {problem}
        </p>
      )}
    </div>
  );
}
