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
  { href: '/settings', label: 'Settings', icon: 'settings', roles: ALL },
];

const STAFF_PREFIXES = ['/dashboard', '/bookings', '/walk-in', '/notifications', '/settings'];

/** Whether this role may open the page at `pathname`. */
export function canOpen(role: OwnerRole, pathname: string): boolean {
  if (role === 'OWNER_ADMIN') return true;
  return STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
