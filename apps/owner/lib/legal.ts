/**
 * Who the Venue Partner Terms name, and where the customer site's own policies live. Set these for the real business in the owner
 * portal's environment (NEXT_PUBLIC_* values are read when the portal is built).
 */
export const LEGAL = {
  brand: 'TurfX',
  /** The legal name of the business that runs it. */
  operator: process.env.NEXT_PUBLIC_COMPANY_NAME || 'TurfX',
  address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  /** The date the terms were last changed. Update it whenever the text changes. */
  updated: '31 October 2026',
  law: 'India',
  courts: 'Kerala',
} as const;

/** The customer site (terms of use, privacy policy and the rest live there). */
export const CUSTOMER_SITE_URL = (process.env.NEXT_PUBLIC_CUSTOMER_URL || 'http://localhost:3000').replace(/\/$/, '');
