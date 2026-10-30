'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { LoadingState } from '@/components/ui';

/**
 * Wraps the sign-in pages (login, forgot password): someone who is already signed in goes straight to the portal instead of being
 * shown a form they have no use for. The dashboard then sends staff on to choose a venue where that is needed.
 */
export function SignedInRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  // While it is not yet known who is signed in, or while leaving, show no form (so it never flashes up).
  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingState />
      </div>
    );
  }
  return <>{children}</>;
}
