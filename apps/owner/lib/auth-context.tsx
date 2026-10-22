'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

export interface OwnerVenue {
  id: string;
  name: string;
  facilityCode: string;
  status: string;
}

export interface OwnerUser {
  role: 'VENUE_OWNER';
  id: string;
  organizationId: string;
  ownerRole: 'OWNER_ADMIN' | 'OWNER_STAFF';
  name: string | null;
  email: string | null;
  /** The venues this login may work in: every venue of the organization for an owner admin, only the assigned ones for staff. */
  venues: OwnerVenue[];
}

interface AuthContextValue {
  user: OwnerUser | null;
  loading: boolean;
  isStaff: boolean;
  /** Staff work in one venue at a time; null until they have chosen (an owner admin never needs to). */
  selectedVenueId: string | null;
  selectedVenue: OwnerVenue | null;
  selectVenue: (venueId: string) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Asks the API to email a reset link (always succeeds, whether or not
   * the address exists). */
  requestPasswordReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const storageKey = (userId: string) => `owner.venue.${userId}`;

function readStoredVenue(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OwnerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [chosenVenueId, setChosenVenueId] = useState<string | null>(null);

  // The session is an httpOnly cookie JS can't read, so "who am I?" is
  // always answered by the backend. This is also how a SUPER_ADMIN who
  // signs into the owner portal gets turned away, since /auth/owner/me
  // requires @Roles(VENUE_OWNER). api.ts transparently refreshes an
  // expired access cookie before giving up.
  const syncUser = useCallback(async () => {
    try {
      const me = await api.get<OwnerUser>('/auth/owner/me');
      setUser(me);
      setChosenVenueId(readStoredVenue(me.id));
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    syncUser().finally(() => setLoading(false));
  }, [syncUser]);

  const isStaff = user?.ownerRole === 'OWNER_STAFF';

  // A staff member with one venue is simply in it; with several, their last choice counts only while
  // it is still one of their venues (an owner admin can take a venue away at any time).
  const selectedVenue = useMemo(() => {
    if (!user || !isStaff) return null;
    if (user.venues.length === 1) return user.venues[0]!;
    return user.venues.find((v) => v.id === chosenVenueId) ?? null;
  }, [user, isStaff, chosenVenueId]);

  const selectVenue = useCallback(
    (venueId: string) => {
      setChosenVenueId(venueId);
      if (!user) return;
      try {
        window.localStorage.setItem(storageKey(user.id), venueId);
      } catch {
        // private window: the choice just lasts until the page is closed
      }
    },
    [user],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/owner/login', { email, password });
      await syncUser();
    },
    [syncUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/owner/logout');
    } finally {
      setUser(null);
      setChosenVenueId(null);
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await api.post('/auth/owner/forgot-password', { email });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isStaff,
        selectedVenueId: selectedVenue?.id ?? null,
        selectedVenue,
        selectVenue,
        login,
        logout,
        refreshUser: syncUser,
        requestPasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
