'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';
import { NotificationBell } from '@/components/notification-bell';
import { Icon, LoadingState } from '@/components/ui';
import { canOpen } from '@/lib/access';

const OWNER_ROLE_LABEL: Record<string, string> = {
  OWNER_ADMIN: 'Owner Admin',
  OWNER_STAFF: 'Owner Staff',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, isStaff, selectedVenueId, selectVenue } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Staff with several venues pick one first; then they stay on the pages their role may open.
  const needsVenue = isStaff && !selectedVenueId;
  const blocked = !!user && !canOpen(user.ownerRole, pathname ?? '/');
  useEffect(() => {
    if (loading || !user) return;
    if (needsVenue) router.replace('/choose-venue');
    else if (blocked) router.replace('/dashboard');
  }, [loading, user, needsVenue, blocked, router]);

  // Close the mobile drawer automatically on navigation — otherwise it
  // stays open over the new page after tapping a nav link on a phone.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }
  if (!user) return null; // redirect effect above is about to fire
  if (needsVenue || blocked) return null; // so is this one

  return (
    <div className="bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="md:pl-64">
        <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-outline-variant/20 bg-surface/80 px-container-padding backdrop-blur-xl md:left-64 md:justify-end">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface hover:bg-surface-container-highest md:hidden"
          >
            <Icon name="menu" />
          </button>
          <div className="flex items-center gap-3">
            {isStaff && user.venues.length > 0 && (
              <label className="flex items-center gap-2">
                <span className="sr-only">Venue</span>
                <Icon name="storefront" className="hidden text-on-surface-variant sm:inline" />
                {user.venues.length > 1 ? (
                  <select
                    value={selectedVenueId ?? ''}
                    onChange={(e) => selectVenue(e.target.value)}
                    aria-label="Venue"
                    className="h-10 max-w-[12rem] rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-3 text-body-md font-medium text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 sm:max-w-xs"
                  >
                    {user.venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="max-w-[12rem] truncate text-body-md font-medium text-on-surface sm:max-w-xs">
                    {user.venues[0]!.name}
                  </span>
                )}
              </label>
            )}
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-body-md font-semibold text-on-surface">{user.name ?? OWNER_ROLE_LABEL[user.ownerRole]}</p>
              <p className="font-label-md text-label-md text-on-surface-variant">
                {OWNER_ROLE_LABEL[user.ownerRole] ?? user.ownerRole}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Icon name="person" className="text-on-primary" />
            </div>
          </div>
        </header>
        <main className="min-h-screen p-container-padding pt-24">{children}</main>
      </div>
    </div>
  );
}
