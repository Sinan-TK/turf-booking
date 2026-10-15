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
