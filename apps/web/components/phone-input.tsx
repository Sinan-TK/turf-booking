'use client';

import type { InputHTMLAttributes } from 'react';
/** The Indian flag as a small inline image (flag emoji do not render on Windows). */
function IndiaFlag() {
  return (
    <svg viewBox="0 0 30 20" width="22" height="15" aria-hidden="true" className="shrink-0 rounded-[2px] ring-1 ring-black/10">
      <rect width="30" height="20" fill="#fff" />
      <rect width="30" height="6.67" fill="#ff9933" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.7" />
    </svg>
  );
}

/** What a typed or pasted value becomes: digits only, without a +91 / 91 / 0 in front, at most 10. */
export function nationalDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** The 10 digits of a stored number such as "+919876543210" (anything that is not an Indian number is returned as is). */
export function toNationalDigits(stored: string | null | undefined): string {
  if (!stored) return '';
  return stored.startsWith('+91') ? stored.slice(3) : stored;
}

/** "+919876543210" as "+91 98765 43210" (other numbers are shown as stored). */
export function formatPhone(stored: string): string {
  return stored.startsWith('+91') && stored.length === 13 ? `+91 ${stored.slice(3, 8)} ${stored.slice(8)}` : stored;
}

/**
 * A phone field for Indian numbers: the flag and +91 sit in front of the box, and the box itself holds only the
 * 10 digits. The value is the 10 digits; the API adds the country code.
 */
export function PhoneInput({
  value,
  onValueChange,
  invalid = false,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (digits: string) => void;
  invalid?: boolean;
}) {
  return (
    <div
      className={`flex w-full items-stretch overflow-hidden rounded-md border bg-white focus-within:border-emerald-600 ${
        invalid ? 'border-red-500' : 'border-gray-300'
      }`}
    >
      <span className="flex shrink-0 items-center gap-1.5 border-r border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-700">
        <IndiaFlag />
        <span aria-label="India, country code 91">+91</span>
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="98765 43210"
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onValueChange(nationalDigits(e.target.value))}
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none read-only:bg-gray-50 read-only:text-gray-500"
        {...rest}
      />
    </div>
  );
}
