/**
 * Inline SVG icons for the pre-login pages. The rest of the portal uses the
 * Material Symbols font, which shows the raw icon name until it downloads —
 * on a first, uncached visit to the sign-in page that flash is the first
 * thing a user sees, so these pages draw their icons themselves.
 */
const PATHS = {
  ball: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 8.2l3.4 2.5-1.3 4H9.9l-1.3-4L12 8.2zM12 3v5.2M20.4 9.6l-5-.9M17.6 19l-3.5-4.3M6.4 19l3.5-4.3M3.6 9.6l5-.9',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM9 16l2 2 4-4',
  card: 'M2 7a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM2 10h20',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 100-14 7 7 0 000 14z',
  check: 'M5 13l4 4L19 7',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  pin: 'M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z',
  block: 'M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8',
  unblock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l2.7 2.7L16 9.5',
  trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  back: 'M19 12H5M12 19l-7-7 7-7',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff:
    'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1.1M9.9 9.9a3 3 0 004.2 4.2',
} as const;

export type SvgIconName = keyof typeof PATHS;

export function SvgIcon({ name, className = 'h-5 w-5' }: { name: SvgIconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
