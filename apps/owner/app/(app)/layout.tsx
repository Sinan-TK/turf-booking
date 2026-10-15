'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';
import { NotificationBell } from '@/components/notification-bell';
import { Icon, LoadingState } from '@/components/ui';

const OWNER_ROLE_LABEL: Record<string, string> = {
  OWNER_ADMIN: 'Owner Admin',
  OWNER_STAFF: 'Owner Staff',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

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
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-body-md font-semibold text-on-surface">
                {OWNER_ROLE_LABEL[user.ownerRole] ?? user.ownerRole}
              </p>
              <p className="font-label-md text-label-md text-on-surface-variant">Venue Owner</p>
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
