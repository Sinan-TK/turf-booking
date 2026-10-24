import { z } from 'zod';

export const INDIAN_MOBILE_MESSAGE = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';

/**
 * Canonical form of every phone number kept for a customer: "+91" and the ten digits. The service is India-only,
 * so this is the one place a number is accepted: a real mobile number is ten digits starting with 6, 7, 8 or 9
 * and not one digit repeated. The usual ways of writing it are all fine ("98765 43210", "+91 98765-43210",
 * "919876543210", "09876543210"); anything else returns null. Because every entry point goes through here,
 * two spellings of one phone can never become two customers.
 */
export function normalizeIndianMobile(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let national = digits;
  if (digits.length === 12 && digits.startsWith('91')) national = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) national = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(national) || new Set(national).size === 1) return null;
  // Letters or other symbols mixed in are refused rather than silently dropped (spaces, dashes, brackets and a + are fine).
  if (/[^\d\s\-().+]/.test(input)) return null;
  return `+91${national}`;
}

/** For request bodies: a phone number that must be a real Indian mobile number, stored in the canonical +91 form. */
export const indianMobileSchema = z.string().transform((value, ctx) => {
  const phone = normalizeIndianMobile(value);
  if (!phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: INDIAN_MOBILE_MESSAGE });
    return z.NEVER;
  }
  return phone;
});
