'use client';

import { useState } from 'react';
import { useCustomer } from '@/lib/customer';
import { ConfirmLogout } from '@/components/confirm-logout';
import { Icon } from '@/components/ui';

/** "Log out" for a page's top bar, with a confirmation. Shown only while someone is signed in. */
export function LogoutButton() {
  const { customer, logout } = useCustomer();
  const [confirming, setConfirming] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  if (!customer) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 active:scale-95"
      >
        <Icon name="logout" className="text-[16px]" />
        Log out
      </button>
      {confirming && (
        <ConfirmLogout
          busy={loggingOut}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await logout();
            } catch {
              // the page shows the real state either way
            } finally {
              setLoggingOut(false);
              setConfirming(false);
            }
          }}
        />
      )}
    </>
  );
}
