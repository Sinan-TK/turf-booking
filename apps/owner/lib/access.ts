/**
 * What each owner-portal role can open. The API is the real gate (a staff token is refused on every
 * admin-only endpoint); this only keeps staff out of pages that would just show errors, and decides
 * which sidebar items to show.
 */
export type OwnerRole = 'OWNER_ADMIN' | 'OWNER_STAFF';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: OwnerRole[];
}

const ALL: OwnerRole[] = ['OWNER_ADMIN', 'OWNER_STAFF'];
const ADMIN: OwnerRole[] = ['OWNER_ADMIN'];

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard', roles: ALL },
  { href: '/bookings/day', label: 'Day view', icon: 'today', roles: ALL },
  { href: '/bookings', label: 'Bookings', icon: 'event', roles: ALL },
  { href: '/walk-in', label: 'Walk-in booking', icon: 'edit_calendar', roles: ALL },
  { href: '/venues', label: 'My Venues', icon: 'storefront', roles: ADMIN },
  { href: '/staff', label: 'Staff', icon: 'group', roles: ADMIN },
  { href: '/notifications', label: 'Notifications', icon: 'notifications', roles: ALL },
  { href: '/earnings', label: 'Earnings', icon: 'account_balance_wallet', roles: ADMIN },
  { href: '/payments', label: 'Payments', icon: 'payments', roles: ADMIN },
  { href: '/refunds', label: 'Refunds', icon: 'currency_exchange', roles: ADMIN },
  { href: '/audit-log', label: 'Audit log', icon: 'history', roles: ADMIN },
  { href: '/settings', label: 'Settings', icon: 'settings', roles: ALL },
];

const STAFF_PREFIXES = ['/dashboard', '/bookings', '/walk-in', '/notifications', '/settings'];

/** Whether this role may open the page at `pathname`. */
export function canOpen(role: OwnerRole, pathname: string): boolean {
  if (role === 'OWNER_ADMIN') return true;
  return STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** How each role is named to people (never the raw enum). */
export const ROLE_LABEL: Record<OwnerRole, string> = {
  OWNER_ADMIN: 'Owner admin',
  OWNER_STAFF: 'Staff',
};

/** One sentence on what each role is for, shown on the account page. */
export const ROLE_SUMMARY: Record<OwnerRole, string> = {
  OWNER_ADMIN: 'You manage every venue, its prices, your staff, and see earnings, payments and refunds.',
  OWNER_STAFF: 'You take and manage bookings at the venues your owner admin assigned to you.',
};

/** What a staff login can do, and what stays with the owner admin. Mirrors STAFF_PREFIXES and the API's role checks. */
export const STAFF_CAN = [
  'See the day view and every booking at the assigned venues',
  'Take walk-in bookings',
  'Get alerts when a slot is booked',
];
export const STAFF_CANNOT = ['Earnings, payments and refunds', 'Venues, units, prices and closed days', 'Inviting or changing other staff'];
