/**
 * A safe identifier for correlating timing logs across a single WhatsApp
 * exchange without ever writing a full phone number (personal data) to
 * logs — keeps only the last 4 digits, matching how partial identifiers
 * are commonly shown elsewhere (e.g. masked card numbers).
 */
export function maskPhone(whatsappNumber: string): string {
  const digits = whatsappNumber.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}
