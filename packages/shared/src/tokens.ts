import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * Generates a cryptographically secure, URL-safe opaque token for
 * BookingSession links and CustomerSession cookies. Never derived from or
 * containing the customer's phone number (ARCHITECTURE.md §17).
 */
export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored hashed (SHA-256) — the raw value only ever exists in
 * the URL/cookie handed to the customer. A DB leak does not expose usable
 * session tokens.
 */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
