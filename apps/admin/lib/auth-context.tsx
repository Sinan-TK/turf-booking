'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

interface AdminUser {
  role: 'SUPER_ADMIN';
  id: string;
}

interface AuthContextValue {
  user: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Asks the API to email a reset link (always succeeds, whether or not
   * the address exists). */
  requestPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  // The session is an httpOnly cookie JS can't read, so "who am I?" is
  // always answered by the backend. This is also how a VENUE_OWNER who
  // signs into the wrong portal gets turned away, since /auth/admin/me
  // requires @Roles(SUPER_ADMIN). api.ts transparently refreshes an
  // expired access cookie before giving up.
  const syncUser = useCallback(async () => {
    try {
      setUser(await api.get<AdminUser>('/auth/admin/me'));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    syncUser().finally(() => setLoading(false));
  }, [syncUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/admin/login', { email, password });
      await syncUser();
    },
    [syncUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/admin/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await api.post('/auth/admin/forgot-password', { email });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, requestPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
