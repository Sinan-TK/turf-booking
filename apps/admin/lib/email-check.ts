import { api } from './api';

/**
 * Whether an owner login already uses this email: true (taken), false (free), or null when it could not be told (no network, rate limit,
 * a half-typed address), which never blocks anything: the server still refuses a taken address when the form is sent.
 */
export async function isOwnerEmailTaken(email: string): Promise<boolean | null> {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  try {
    const res = await api.post<{ available: boolean }>('/auth/owner/email-check', { email: value });
    return !res.available;
  } catch {
    return null;
  }
}

export const OWNER_EMAIL_TAKEN_MESSAGE = 'An owner login with this email already exists.';
