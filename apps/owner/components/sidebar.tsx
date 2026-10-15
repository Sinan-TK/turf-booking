'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { Icon } from './ui';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/venues', label: 'My Venues', icon: 'storefront' },
  { href: '/bookings', label: 'Bookings', icon: 'event' },
  { href: '/notifications', label: 'Notifications', icon: 'notifications' },
  { href: '/payments', label: 'Payments', icon: 'payments' },
  { href: '/refunds', label: 'Refunds', icon: 'currency_exchange' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

interface SidebarProps {
  /** Whether the off-canvas drawer is open on small screens — ignored at
   * the md breakpoint and up, where the sidebar is always visible. */
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  return (
    <>
      {/* Backdrop — only rendered while the mobile drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-outline-variant/30 bg-surface-container-low transition-transform duration-200 ease-out md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex h-16 items-center justify-between px-container-padding">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Icon name="sports_soccer" className="text-on-primary" />
            </div>
            <span className="font-headline-sm text-headline-sm tracking-tight text-primary">Venue Booking</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest md:hidden"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 pb-4">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all ${
                  active
                    ? 'bg-primary-container text-on-primary-container font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                <Icon name={item.icon} />
                <span className="font-label-md text-label-md">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-outline-variant/30 px-4 py-4">
          <button
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-error transition-all hover:bg-error-container"
          >
            <Icon name="logout" />
            <span className="font-label-md text-label-md">Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
