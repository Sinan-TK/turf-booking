/**
 * Canonical E.164-style form used for CustomerProfile.whatsappNumber: "+" then
 * digits. A bare 10-digit number gets the default country code. Returns
 * null for anything that is not 11–15 digits after cleaning, so two
 * spellings of one phone can never become two customers.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  const digits = cleaned.replace(/^\+/, '').replace(/^00/, '');
  if (!/^\d+$/.test(digits)) return null;
  const full = digits.length === 10 ? defaultCountryCode + digits : digits;
  return full.length >= 11 && full.length <= 15 ? `+${full}` : null;
}

/**
 * For a customer typing their own number: an Indian (+91) number must be a real mobile number, ten digits starting
 * with 6, 7, 8 or 9 and not one digit repeated. Numbers from other countries are only checked by normalizePhone.
 * Returns a message to show, or null when the number is fine.
 */
export function mobileNumberProblem(e164: string): string | null {
  if (!e164.startsWith('+91')) return null;
  const national = e164.slice(3);
  if (!/^[6-9]\d{9}$/.test(national) || new Set(national).size === 1) {
    return 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
  }
  return null;
}
