'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth-context';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { ConfirmDialog } from './confirm-dialog';
import { NAV_ITEMS } from '../lib/access';

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
  const { logout, user } = useAuth();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // The rail is expanded by pointer hover or keyboard focus — driven by state
  // rather than CSS :hover so it can collapse the moment a link is clicked,
  // even though the pointer is still over it while the next page loads.
  const [expanded, setExpanded] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  // The item just clicked is highlighted immediately, before the route finishes loading.
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

  // Each role sees only the pages it may open (staff: bookings, day view, walk-in, notifications).
  const items = NAV_ITEMS.filter((i) => !user || i.roles.includes(user.ownerRole));
  // The longest matching href wins, so /bookings/day does not also light up /bookings.
  const current = pendingHref ?? pathname;
  const activeHref = items
    .filter((i) => current === i.href || current?.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      {/* Backdrop — only rendered while the mobile drawer is open. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

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
        className={`fixed left-0 top-0 z-50 flex h-full w-64 flex-col overflow-hidden border-r border-outline-variant/30 bg-surface-container-low transition-[transform,width,box-shadow] duration-200 ease-out md:translate-x-0 ${
          expanded ? 'md:w-64 md:shadow-xl' : 'md:w-[72px]'
        } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-4 flex h-16 items-center justify-between pl-[20px] pr-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
              <Icon name="sports_soccer" className="text-on-primary" />
            </div>
            <span className={`font-headline-sm text-headline-sm tracking-tight text-primary ${R}`}>Bookyo</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest md:hidden"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-4">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => collapseAfterNavigate(item.href)}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-[14px] py-3 transition-colors ${
                  active
                    ? 'bg-primary-container text-on-primary-container font-semibold'
                    : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
                }`}
              >
                <Icon name={item.icon} className="shrink-0" />
                <span className={`font-label-md text-label-md ${R}`}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-outline-variant/30 px-3 py-4">
          <button
            onClick={() => setConfirmingLogout(true)}
            title="Log out"
            className="flex w-full items-center gap-3 rounded-xl px-[14px] py-3 text-error transition-colors hover:bg-error-container"
          >
            <Icon name="logout" className="shrink-0" />
            <span className={`font-label-md text-label-md ${R}`}>Log out</span>
          </button>
        </div>
      </aside>
      {confirmingLogout &&
        createPortal(
        <ConfirmDialog
          title="Log out?"
          confirmLabel="Log out"
          tone="danger"
          busy={loggingOut}
          onCancel={() => setConfirmingLogout(false)}
          onConfirm={async () => {
            setLoggingOut(true);
            try {
              await logout();
              router.replace('/login');
            } finally {
              setLoggingOut(false);
              setConfirmingLogout(false);
            }
          }}
        >
          You will need to sign in again to continue.
        </ConfirmDialog>,
          document.body,
        )}
    </>
  );
}
