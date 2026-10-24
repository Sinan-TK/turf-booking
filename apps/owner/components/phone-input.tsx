'use client';

import type { InputHTMLAttributes } from 'react';

/** The Indian flag as a small inline image (flag emoji do not render on Windows): three equal bands and the Ashoka Chakra. */
const CHAKRA_SPOKES = Array.from({ length: 24 }, (_, i) => {
  const angle = (i * 15 * Math.PI) / 180;
  return { x: 450 + 75 * Math.cos(angle), y: 300 + 75 * Math.sin(angle) };
});
function IndiaFlag() {
  return (
    <svg viewBox="0 0 900 600" width="24" height="16" role="img" aria-label="Flag of India" className="shrink-0 rounded-[3px] ring-1 ring-black/10">
      <rect width="900" height="600" fill="#fff" />
      <rect width="900" height="200" fill="#ff9933" />
      <rect y="400" width="900" height="200" fill="#138808" />
      <g stroke="#000080" fill="none">
        <circle cx="450" cy="300" r="75" strokeWidth="9" />
        {CHAKRA_SPOKES.map((p, i) => (
          <line key={i} x1="450" y1="300" x2={p.x} y2={p.y} strokeWidth="4" />
        ))}
      </g>
      <circle cx="450" cy="300" r="14" fill="#000080" />
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

/** "+919876543210" as "+91 98765 43210" (other values are shown as stored). */
export function formatPhone(stored: string | null | undefined): string {
  if (!stored) return '';
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
      className={`flex w-full items-stretch overflow-hidden rounded-lg border bg-surface-container-lowest transition-colors focus-within:ring-2 ${
        invalid
          ? 'border-error focus-within:ring-error/20'
          : 'border-outline-variant/40 hover:border-outline focus-within:border-primary focus-within:ring-primary/20'
      }`}
    >
      <span className="flex shrink-0 items-center gap-1.5 border-r border-outline-variant/30 bg-surface-container px-3 text-body-md text-on-surface-variant">
        <IndiaFlag />
        <span aria-label="India, country code 91">+91</span>
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        placeholder="98765 43210"
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onValueChange(nationalDigits(e.target.value))}
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/60"
        {...rest}
      />
    </div>
  );
}
