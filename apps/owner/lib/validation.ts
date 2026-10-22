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
  if (value.length < 8) return 'Use at least 8 characters.';
  if (value.length > 128) return 'Use at most 128 characters.';
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

/** A WhatsApp number: 6-20 characters of digits, with an optional leading + and spaces or dashes. */
export function phoneError(value: string): string | undefined {
  const v = value.trim();
  if (!v) return 'Enter the customer’s WhatsApp number.';
  if (!/^\+?[\d\s-]+$/.test(v)) return 'Use digits only, with an optional + at the start.';
  const compact = v.replace(/[\s-]/g, '');
  if (compact.length < 6 || compact.length > 20) return 'Enter a full phone number, like +91 98765 43210.';
}
