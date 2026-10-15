import type { StaffPortal } from '@venue/database';

/**
 * Clean-Architecture port: IdentityService (use-case) depends on this, not
 * on how credentials are delivered or sessions are stored.
 * LocalIdentityAdapter is the implementation (Neon-backed credentials +
 * Resend emails); swapping in a hosted IdP later means a new adapter only.
 */
export interface IdentityProvider {
  /** Emails a single-use link letting a newly created user set their password. */
  sendInvite(params: {
    portal: StaffPortal;
    userId: string;
    email: string;
    name: string;
  }): Promise<void>;

  /** Emails a single-use password-reset link. */
  sendPasswordReset(params: {
    portal: StaffPortal;
    userId: string;
    email: string;
    name: string;
  }): Promise<void>;

  /** Invalidates every refresh session for the user ("logout everywhere"). */
  revokeAllSessions(portal: StaffPortal, userId: string): Promise<void>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');
