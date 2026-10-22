/** Browser-side checks for the customer forms. The API still validates everything; these only
 * give the person a message under the field before anything is sent. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export const hasErrors = (e: object) => Object.values(e).some(Boolean);

export function phoneError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your WhatsApp number.';
  if (!/^\+?[\d\s-]+$/.test(v)) return 'Use digits only, with an optional + at the start.';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10) return 'Enter the full 10-digit number.';
  if (v.length > 30) return 'That number is too long.';
}

export function codeError(value: string): string | undefined {
  if (!value) return 'Enter the 6-digit code.';
  if (!/^\d{6}$/.test(value)) return 'The code is 6 digits.';
}

export function nameError(value: string, label = 'name'): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your ' + label + '.';
  if (v.length > 80) return 'Keep your ' + label + ' to 80 characters.';
}
