/** Browser-side checks shared by the owner forms. The API still validates everything; these only
 * give the person a message under the field before anything is sent. */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter your email address.';
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

/** The customer's Indian mobile number as typed in the phone field (the 10 digits after +91). The server checks the same rules. */
export function indianPhoneError(digits: string): string | undefined {
  if (!digits) return 'Enter the customer’s phone number.';
  if (digits.length !== 10) return 'Enter the full 10-digit mobile number.';
  if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  if (new Set(digits).size === 1) return 'Enter a real mobile number.';
}
