'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCustomer } from '@/lib/customer';
import { ConfirmLogout } from '@/components/confirm-logout';

const ITEMS = [
  { href: '/account?tab=profile', label: 'Profile' },
  { href: '/bookings', label: 'My bookings' },
  { href: '/account?tab=wallet', label: 'Wallet (Coins)' },
  { href: '/support', label: 'Support' },
];

/** Header control: "Log in" when logged out, otherwise an avatar with the
 * customer's menu. Closes on Escape, outside click or choosing an item. */
export function AccountMenu() {
  const { customer, loading, requireLogin, logout } = useCustomer();
  const [open, setOpen] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (loading) return <div className="h-9 w-9" aria-hidden="true" />;

  if (!customer) {
    return (
      <button
        type="button"
        onClick={() => requireLogin().catch(() => undefined)}
        className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-95"
      >
        Log in
      </button>
    );
  }

  const initial = (customer.name?.trim() || customer.email || customer.phone?.replace(/\D/g, '') || '?').charAt(0).toUpperCase();

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-[60] mt-2 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-sm font-semibold text-slate-900">{customer.name ?? 'Your account'}</p>
            <p className="truncate text-xs text-slate-500">{customer.email ?? customer.phone}</p>
          </div>
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setConfirmingLogout(true);
            }}
            className="block w-full border-t border-slate-100 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      )}
      {confirmingLogout && (
        <ConfirmLogout
          busy={loggingOut}
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await logout();
            } catch {
              // a failed request still leaves the dialog to close; the header shows the real state
            } finally {
              setLoggingOut(false);
              setConfirmingLogout(false);
            }
          }}
        />
      )}
    </div>
  );
}
