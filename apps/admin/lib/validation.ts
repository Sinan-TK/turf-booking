/** Browser-side checks shared by the owner forms. The API still validates everything; these only
 * give the person a message under the field before anything is sent. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string, label = 'your email address'): string | undefined {
  const v = value.trim();
  if (!v) return `Enter ${label}.`;
  if (!EMAIL_SHAPE.test(v)) return 'Enter a valid email address, like you@company.com.';
}

export function newPasswordError(value: string): string | undefined {
  if (!value) return 'Enter a new password.';
  if (value.length > 128) return 'Use at most 128 characters.';
  if (value.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) {
    return 'Use a capital letter, a small letter, a number and a special character.';
  }
}

/** Required text with an optional length range; `label` reads like "Venue name". */
export function textError(value: string, label: string, min = 1, max = 200): string | undefined {
  const v = value.trim();
  if (v.length < min) return min <= 1 ? `Enter the ${label.toLowerCase()}.` : `${label} needs at least ${min} characters.`;
  if (v.length > max) return `${label} can be at most ${max} characters.`;
}

/** A whole number within a range, typed into a text/number input. */
export function intError(value: string, label: string, min: number, max: number): string | undefined {
  if (value.trim() === '') return `Enter ${label.toLowerCase()}.`;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return `${label} must be a whole number.`;
  if (n < min) return `${label} must be at least ${min}.`;
  if (n > max) return `${label} must be at most ${max}.`;
}

export const hasErrors = (e: object) => Object.values(e).some(Boolean);

/** A decimal within a range (latitude, longitude, prices). */
export function numberError(value: string, label: string, min: number, max: number): string | undefined {
  if (value.trim() === '') return `Enter the ${label.toLowerCase()}.`;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (n < min || n > max) return `${label} must be between ${min} and ${max}.`;
}

/**
 * An Indian mobile number as typed in the phone field (the 10 digits after +91): ten digits, starting with 6, 7, 8 or 9,
 * and not one digit repeated. The server checks the same rules. Pass required = false where the field may stay empty.
 */
export function indianPhoneError(digits: string, label = 'the phone number', required = true): string | undefined {
  if (!digits) return required ? `Enter ${label}.` : undefined;
  if (digits.length !== 10) return 'Enter the full 10-digit mobile number.';
  if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  if (new Set(digits).size === 1) return 'Enter a real mobile number.';
}

/** A record id typed by hand (a UUID). */
export function uuidError(value: string, label: string): string | undefined {
  const v = value.trim();
  if (!v) return `Enter the ${label.toLowerCase()}.`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return `${label} should look like 123e4567-e89b-12d3-a456-426614174000.`;
}
