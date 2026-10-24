/** Browser-side checks for the customer forms. The API still validates everything; these only
 * give the person a message under the field before anything is sent. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export const hasErrors = (e: object) => Object.values(e).some(Boolean);


/**
 * An Indian mobile number as typed in the phone field (the 10 digits after +91): ten digits, starting with 6, 7, 8 or 9,
 * and not one digit repeated. The server checks the same rules.
 */
export function indianPhoneError(digits: string): string | undefined {
  if (!digits) return 'Enter your phone number.';
  if (!/^\d+$/.test(digits)) return 'Use digits only.';
  if (digits.length !== 10) return 'Enter the full 10-digit mobile number.';
  if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  if (new Set(digits).size === 1) return 'Enter a real mobile number.'; // one digit repeated
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

/** How hard a password is to guess, for the meter shown while typing. Informational: the only rule is 8 to 128 characters. */
export function passwordStrength(value: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (value.length < 8) return { level: 0, label: value ? 'Too short' : '' };
  const points =
    Number(value.length >= 12) +
    Number(/[a-z]/.test(value) && /[A-Z]/.test(value)) +
    Number(/\d/.test(value)) +
    Number(/[^A-Za-z0-9]/.test(value));
  if (points <= 1) return { level: 1, label: 'Weak' };
  if (points === 2) return { level: 2, label: 'Okay' };
  return { level: 3, label: 'Strong' };
}

export function passwordError(value: string): string | undefined {
  if (!value) return 'Enter your password.';
}
