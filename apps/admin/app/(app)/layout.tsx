'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';
import { Icon } from '@/components/icons';
import { LoadingState } from '@/components/ui';

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
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }
  if (!user) return null; // redirect effect above is about to fire

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/85 px-4 backdrop-blur md:hidden">
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="rounded-lg p-1.5 text-gray-700 hover:bg-gray-100"
        >
          <Icon name="menu" className="h-5 w-5" />
        </button>
        <p className="text-sm font-semibold text-gray-900">Venue Booking</p>
      </header>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:px-8 lg:py-8">
        <div className="w-full">{children}</div>
      </main>
    </div>
  );
}
