/** Browser-side checks for the customer forms. The API still validates everything; these only
 * give the person a message under the field before anything is sent. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export const hasErrors = (e: object) => Object.values(e).some(Boolean);

export function phoneError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your phone number.';
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


const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
  if (v.length > 254 || !EMAIL_SHAPE.test(v)) return 'Enter a valid email address, like you@example.com.';
}

/** A new password (sign-up, reset, change). Signing in only asks that something was typed. */
export function newPasswordError(value: string): string | undefined {
  if (!value) return 'Enter a password.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (value.length > 128) return 'Use at most 128 characters.';
}

export function passwordError(value: string): string | undefined {
  if (!value) return 'Enter your password.';
}
