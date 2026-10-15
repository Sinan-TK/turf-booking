'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { Icon, type IconName } from './icons';

const NAV_GROUPS: Array<{ title: string; items: Array<{ href: string; label: string; icon: IconName }> }> = [
  {
    title: 'Overview',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: 'dashboard' }],
  },
  {
    title: 'Catalogue',
    items: [
      { href: '/venues', label: 'Venues', icon: 'venue' },
      { href: '/venue-types', label: 'Venue types', icon: 'tag' },
      { href: '/owners', label: 'Owners', icon: 'building' },
      { href: '/locations', label: 'Locations', icon: 'pin' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { href: '/bookings', label: 'Bookings', icon: 'calendar' },
      { href: '/payments', label: 'Payments', icon: 'card' },
      { href: '/refunds', label: 'Refunds', icon: 'refund' },
      { href: '/customers', label: 'Customers', icon: 'users' },
      { href: '/support', label: 'Support', icon: 'support' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { href: '/policies', label: 'Policies', icon: 'shield' },
      { href: '/announcements', label: 'Announcements', icon: 'megaphone' },
    ],
  },
];

interface SidebarProps {
  /** Whether the off-canvas drawer is open on small screens — ignored at
   * the md breakpoint and up, where the sidebar is a slim icon rail that
   * expands over the page while hovered or focused. */
  open: boolean;
  onClose: () => void;
}

/** Text that is always visible in the mobile drawer but, on md+, only
 * appears while the rail is expanded. */
const reveal = (expanded: boolean) =>
  `whitespace-nowrap md:transition-opacity md:duration-150 ${expanded ? 'md:opacity-100' : 'md:opacity-0'}`;

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();

  // The rail is expanded by pointer hover or keyboard focus — driven by
  // state rather than CSS :hover so it can collapse the moment a link is
  // clicked, even though the pointer is still over it (and the clicked link
  // still holds focus) while the next page loads.
  const [expanded, setExpanded] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  // The item just clicked is highlighted immediately, before the route
  // finishes loading, so navigation feels instant.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => setPendingHref(null), [pathname]);

  const collapseAfterNavigate = (href: string) => {
    setPendingHref(href);
    setExpanded(false);
    setSuppressed(true); // stay collapsed until the pointer leaves and returns
    (document.activeElement as HTMLElement | null)?.blur();
    onClose();
  };
  const R = reveal(expanded);

  return (
    <>
      {/* Backdrop — only rendered while the mobile drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-gray-950/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Reserves the rail's width so the page never shifts when it expands. */}
      <div className="hidden w-[72px] shrink-0 md:block" aria-hidden="true" />

      <aside
        onMouseEnter={() => !suppressed && setExpanded(true)}
        onMouseLeave={() => {
          setExpanded(false);
          setSuppressed(false);
        }}
        onFocus={(e) => {
          if (!suppressed && e.target.matches(':focus-visible')) setExpanded(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false);
        }}
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col overflow-hidden bg-gray-900 text-gray-300 transition-[transform,width,box-shadow] duration-200 ease-out md:translate-x-0 ${
          expanded ? 'md:w-64 md:shadow-pop' : 'md:w-[72px]'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between py-5 pl-[18px] pr-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-900/40">
              <Icon name="venue" className="h-5 w-5" />
            </span>
            <div className={R}>
              <p className="text-sm font-semibold leading-tight text-white">Venue Booking</p>
              <p className="text-xs text-gray-400">Super Admin</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white md:hidden"
          >
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <p className={`mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 ${R}`}>
                {group.title}
              </p>
              {/* Collapsed rail: a hairline stands in for the hidden group title. */}
              <div className={`mx-3 mb-1.5 hidden h-px bg-white/10 ${expanded ? '' : 'md:block'}`} />
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const current = pendingHref ?? pathname;
                  const active = current === item.href || current?.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => collapseAfterNavigate(item.href)}
                      title={item.label}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg px-[15px] py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-white/10 text-white'
                          : 'text-gray-400 hover:bg-white/5 hover:text-gray-100'
                      }`}
                    >
                      {active && (
                        <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-400" />
                      )}
                      <Icon
                        name={item.icon}
                        className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-brand-400' : 'text-gray-500 group-hover:text-gray-300'}`}
                      />
                      <span className={R}>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
            title="Log out"
            className="flex w-full items-center gap-3 rounded-lg px-[15px] py-2 text-left text-sm font-medium text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon name="logout" className="h-[18px] w-[18px] shrink-0" />
            <span className={R}>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
