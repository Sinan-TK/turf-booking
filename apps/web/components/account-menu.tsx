'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCustomer } from '@/lib/customer';
import { ConfirmLogout } from '@/components/confirm-logout';
import { Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

const ITEMS = [
  { href: '/account?tab=profile', label: 'Profile', icon: 'person' },
  { href: '/account?tab=bookings', label: 'Bookings', icon: 'bookings' },
  { href: '/account?tab=wallet', label: 'Wallet (Coins)', icon: 'coin' },
  { href: '/support', label: 'Support', icon: 'support' },
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

  // The first letter of the customer's name (or email, when there is no name yet) stands in for the profile picture.
  const initial = Array.from((customer?.name ?? customer?.email ?? '').trim().replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? null;

  if (loading) return <Skeleton className="h-10 w-10 rounded-xl" />;

  if (!customer) {
    return (
      <button
        type="button"
        onClick={() => requireLogin().catch(() => undefined)}
        className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white pl-3 pr-4 text-sm font-bold text-slate-800 transition hover:border-brand-400 active:scale-95 md:h-12 md:pl-3.5 md:pr-5"
      >
        <Icon name="login" className="text-[1.125rem] text-brand-600" />
        Log in
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 md:gap-3">
      <div ref={root} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={customer.name ?? 'Your account'}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-brand-300 bg-brand-400 text-base font-extrabold uppercase leading-none text-brand-700 transition hover:bg-brand-300 active:scale-95 md:h-11 md:w-11 md:text-lg"
      >
        {initial ? <span aria-hidden="true">{initial}</span> : <Icon name="person" className="text-[1.25rem] md:text-[1.375rem]" />}
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
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Icon name={item.icon} className="text-[1rem] text-slate-400" />
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
            className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
          >
            <Icon name="logout" className="text-[1rem]" />
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
    </div>
  );
}
