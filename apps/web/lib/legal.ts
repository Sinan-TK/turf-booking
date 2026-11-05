/**
 * The facts the legal pages state about who runs the service. Set these for the real business in the web app's environment
 * (NEXT_PUBLIC_* values are read when the site is built); until then the pages name the brand and point people to the Support page.
 */
export const LEGAL = {
  /** The name customers know. */
  brand: 'Bookyo',
  /** The legal name of the business that runs it (a company, firm or person), as it should appear in the policies. */
  operator: process.env.NEXT_PUBLIC_COMPANY_NAME || 'Bookyo',
  /** Registered or postal address, shown when set. */
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '',
  /** Where privacy, legal and grievance messages go, shown when set. */
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  /** The date the policies were last changed. Update it whenever the text changes. */
  updated: '31 October 2026',
  /** Which country's law, and which city's courts, the terms point to. */
  law: 'India',
  courts: 'Kerala',
} as const;

export interface LegalLink {
  href: string;
  label: string;
}

/** Every legal page, in the order they are listed in footers and on each page. */
export const LEGAL_LINKS: LegalLink[] = [
  { href: '/terms', label: 'Terms of Use' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refunds', label: 'Cancellation & Refunds' },
  { href: '/cookies', label: 'Cookie Policy' },
];

/** Where venue owners sign in, create an account and read the Venue Partner Terms (the owner portal, a separate site). */
export const OWNER_PORTAL_URL = (process.env.NEXT_PUBLIC_OWNER_URL || 'http://localhost:3002').replace(/\/$/, '');
