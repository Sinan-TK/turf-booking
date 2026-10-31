'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type OwnerUser } from '@/lib/auth-context';
import { Button } from '@/components/ui';

/** How often the page quietly asks whether the account has been approved yet. */
const RECHECK_MS = 60_000;

const STEPS = [
  { title: 'Account created', text: 'You set your password and signed in.', state: 'done' },
  { title: 'Our team reviews it', text: 'We look at every new venue business before it can list anything.', state: 'now' },
  { title: 'Set up your venues', text: 'Once approved, you can add venues, prices and photos.', state: 'next' },
] as const;

/**
 * What a new owner sees after signing in until the Super Admin approves the account: no menus, no data, just where things stand.
 * The page asks again every minute and when the tab is shown again, so approval takes effect without anyone refreshing.
 */
export function PendingApproval({ user }: { user: OwnerUser }) {
  const { logout, refreshUser } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  async function check() {
    setChecking(true);
    try {
      await refreshUser();
      setLastChecked(new Date());
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUser();
    }, RECHECK_MS);
    const onShow = () => document.visibilityState === 'visible' && void refreshUser();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [refreshUser]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-on-surface">
      <div className="w-full max-w-lg">
        <p className="font-headline-sm text-headline-sm">
          TurfX <span className="text-primary">for venue owners</span>
        </p>

        <div className="mt-6 rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-6 shadow-sm sm:p-8">
          <h1 className="text-balance font-display-lg text-display-lg text-on-surface">Waiting for approval</h1>
          <p className="mt-3 text-pretty text-body-lg leading-relaxed text-on-surface-variant">
            Thanks{user.name ? `, ${user.name.split(' ')[0]}` : ''}. <strong className="text-on-surface">{user.organizationName ?? 'Your business'}</strong> is created, and our team now checks it
            before you can use the portal. You will get an email at <strong className="text-on-surface">{user.email}</strong> as soon as it is approved.
          </p>

          <ol className="mt-7 space-y-5" aria-label="Where your account stands">
            {STEPS.map((s) => (
              <li key={s.title} className="flex gap-3.5" aria-current={s.state === 'now' ? 'step' : undefined}>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    s.state === 'done'
                      ? 'bg-primary text-on-primary'
                      : s.state === 'now'
                        ? 'bg-primary/15 text-primary ring-2 ring-primary/40'
                        : 'bg-surface-container text-on-surface-variant ring-1 ring-outline-variant/60'
                  }`}
                >
                  {s.state === 'done' ? (
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 10.5l4 4 8-9" />
                    </svg>
                  ) : s.state === 'now' ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden="true" />
                  ) : (
                    '3'
                  )}
                </span>
                <span>
                  <span className="block text-sm font-bold text-on-surface">
                    {s.title}
                    {s.state === 'now' && <span className="ml-2 text-xs font-semibold text-primary">In progress</span>}
                  </span>
                  <span className="block text-sm leading-relaxed text-on-surface-variant">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void check()} disabled={checking} className="px-5 py-2.5">
              {checking ? 'Checking…' : 'Check again'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="px-5 py-2.5"
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              Sign out
            </Button>
            {lastChecked && (
              <span role="status" className="text-xs text-on-surface-variant">
                Still waiting. Checked at {lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
              </span>
            )}
          </div>
        </div>

        <p className="mt-5 text-center text-sm text-on-surface-variant">
          Read the <a href="/partner-terms" className="font-semibold text-primary underline underline-offset-2">Venue Partner Terms</a> while you wait.
        </p>
      </div>
    </main>
  );
}
