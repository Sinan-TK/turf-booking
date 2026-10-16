'use client';

import { useEffect } from 'react';
import { useCustomer } from '@/lib/customer';
import { Button, Card, LoadingState } from '@/components/ui';

/**
 * Renders its children only for a logged-in customer. Logged out, it opens
 * the login dialog and keeps a "Log in" prompt on the page in case the
 * dialog is dismissed. Children mount after login, so their own data
 * fetches run with a valid session.
 */
export function LoginGate({ children, message = 'Log in to continue.' }: { children: React.ReactNode; message?: string }) {
  const { customer, loading, requireLogin } = useCustomer();

  useEffect(() => {
    if (!loading && !customer) requireLogin().catch(() => undefined);
  }, [loading, customer, requireLogin]);

  if (loading) return <LoadingState />;
  if (!customer) {
    return (
      <Card>
        <p className="mb-4 text-center text-sm text-gray-600">{message}</p>
        <Button className="w-full" onClick={() => requireLogin().catch(() => undefined)}>
          Log in
        </Button>
      </Card>
    );
  }
  return <>{children}</>;
}
