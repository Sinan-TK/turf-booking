'use client';

import { clearAccountCache } from '@/lib/account-cache';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { LoginDialog } from '@/components/login-dialog';

export interface Customer {
  id: string;
  name: string | null;
  /** null until the customer adds one (Google and email accounts); a verified number is their identity. */
  phone: string | null;
  email: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  /** Google-only customers have none: they set one through Forgot password. */
  hasPassword: boolean;
  /** Still missing a name or a phone number, which a booking needs. */
  needsProfile: boolean;
}

interface CustomerContextValue {
  customer: Customer | null;
  loading: boolean;
  /** Resolves with the customer once logged in; opens the login dialog first
   * if needed. Rejects with Error('dismissed') when the dialog is closed. */
  requireLogin(): Promise<Customer>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
}

const CustomerContext = createContext<CustomerContextValue | null>(null);

export const DISMISSED = 'dismissed';

interface Pending {
  promise: Promise<Customer>;
  resolve(c: Customer): void;
  reject(e: Error): void;
}

export function CustomerProvider({ children }: { children: React.ReactNode }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Set when someone already signed in is asked for what their profile is missing (e.g. a phone number).
  const [completing, setCompleting] = useState<Customer | null>(null);
  const pending = useRef<Pending | null>(null);
  const customerRef = useRef<Customer | null>(null);
  const initial = useRef<Promise<void> | null>(null);

  const apply = useCallback((c: Customer | null) => {
    if (!c) clearAccountCache(); // signed out, by any route (log out, an expired session): nothing kept for the account pages stays
    customerRef.current = c;
    setCustomer(c);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<Customer>('/customer-auth/me'));
    } catch (err) {
      // 401/403 just means "not logged in"; anything else also leaves the
      // visitor logged out rather than breaking the page.
      if (!(err instanceof ApiError)) console.warn('Could not load the session', err);
      apply(null);
    }
  }, [apply]);

  useEffect(() => {
    initial.current = refresh().finally(() => setLoading(false));
  }, [refresh]);

  const requireLogin = useCallback(async (): Promise<Customer> => {
    await initial.current;
    const current = customerRef.current;
    // Signed in and complete: nothing to ask. Signed in without a phone number (a new Google or email
    // account, or one whose number was verified on another account): ask for it now, before booking.
    if (current && !current.needsProfile) return current;
    if (pending.current) return pending.current.promise;
    setCompleting(current);

    let resolve!: (c: Customer) => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<Customer>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pending.current = { promise, resolve, reject };
    setDialogOpen(true);
    return promise;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/customer-auth/logout');
    } finally {
      clearAccountCache();
      apply(null);
    }
  }, [apply]);

  const onLoggedIn = useCallback(
    (c: Customer) => {
      apply(c);
      setDialogOpen(false);
      setCompleting(null);
      pending.current?.resolve(c);
      pending.current = null;
    },
    [apply],
  );

  // Signed in (the session cookie exists) but the profile step was closed: they are logged in, yet whatever
  // asked for the login is not continued, because it needs the missing details.
  const onIncomplete = useCallback(
    (c: Customer) => {
      apply(c);
      setDialogOpen(false);
      setCompleting(null);
      pending.current?.reject(new Error(DISMISSED));
      pending.current = null;
    },
    [apply],
  );

  const onDismiss = useCallback(() => {
    setDialogOpen(false);
    setCompleting(null);
    pending.current?.reject(new Error(DISMISSED));
    pending.current = null;
  }, []);

  const value = useMemo(
    () => ({ customer, loading, requireLogin, logout, refresh }),
    [customer, loading, requireLogin, logout, refresh],
  );

  return (
    <CustomerContext.Provider value={value}>
      {children}
      {dialogOpen && <LoginDialog customer={completing} onLoggedIn={onLoggedIn} onIncomplete={onIncomplete} onDismiss={onDismiss} />}
    </CustomerContext.Provider>
  );
}

export function useCustomer(): CustomerContextValue {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomer must be used inside <CustomerProvider>');
  return ctx;
}
