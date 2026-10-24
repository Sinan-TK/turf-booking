'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { AuthShell } from '@/components/auth-shell';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button, LoadingState } from '@/components/ui';

/**
 * Shown right after a staff member signs in when they work in more than one venue: everything in
 * the portal (bookings, day view, walk-in) is then scoped to the venue they pick, and the header
 * lets them switch later. An owner admin never sees this.
 */
export default function ChooseVenuePage() {
  const { user, loading, isStaff, selectedVenueId, selectVenue, logout } = useAuth();
  const router = useRouter();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    // An owner admin, or staff with a single venue, has nothing to choose.
    else if (!isStaff || user.venues.length === 1) router.replace('/dashboard');
  }, [loading, user, isStaff, router]);

  if (loading || !user || !isStaff || user.venues.length === 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }

  function pick(id: string) {
    selectVenue(id);
    router.replace('/dashboard');
  }

  return (
    <AuthShell
      title="Choose a venue"
      subtitle={
        user.venues.length === 0
          ? 'No venue is assigned to you yet.'
          : `Hi ${user.name ?? 'there'}, which venue are you working in right now?`
      }
    >
      {user.venues.length === 0 ? (
        <p className="rounded-lg bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
          Ask your owner admin to assign you to a venue, then sign in again.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Your venues">
          {user.venues.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => pick(v.id)}
                aria-current={selectedVenueId === v.id}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-surface-container-low focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  selectedVenueId === v.id ? 'border-primary bg-surface-container-low' : 'border-outline-variant/40'
                }`}
              >
                <span>
                  <span className="block text-body-md font-semibold text-on-surface">{v.name}</span>
                  <span className="block font-mono text-xs text-on-surface-variant">{v.facilityCode}</span>
                </span>
                <span aria-hidden="true" className="text-on-surface-variant">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setConfirmingLogout(true)}
        >
          Sign out
        </Button>
      </div>
      {confirmingLogout && (
        <ConfirmDialog
          title="Sign out?"
          confirmLabel="Sign out"
          tone="danger"
          busy={loggingOut}
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await logout();
              router.replace('/login');
            } finally {
              setLoggingOut(false);
              setConfirmingLogout(false);
            }
          }}
        >
          You will need to sign in again to continue.
        </ConfirmDialog>
      )}
    </AuthShell>
  );
}
