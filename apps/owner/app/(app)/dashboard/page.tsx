'use client';

import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { useAuth } from '@/lib/auth-context';
import { DayBookings } from '@/components/day-bookings';
import { AccessCard } from '@/components/access-card';
import { Badge, Card, EmptyState, ErrorBanner, Icon, PageHeader } from '@/components/ui';

interface Summary {
  totalVenues: number;
  activeVenues: number;
  bookingsToday: number;
  revenueThisMonth: string;
}

interface RecentBooking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  venue: { name: string };
  /** A walk-in recorded by venue staff: its details are on the booking, not a customer account. */
  isWalkIn?: boolean;
  customer: { whatsappNumber: string | null; phoneVerified: boolean; email: string | null; name: string | null };
}

const CARDS: Array<{
  key: keyof Summary;
  label: string;
  icon: string;
  href: string;
  format?: (v: string | number) => string;
}> = [
  { key: 'totalVenues', label: 'My Venues', icon: 'storefront', href: '/venues' },
  { key: 'activeVenues', label: 'Active Venues', icon: 'check_circle', href: '/venues' },
  { key: 'bookingsToday', label: 'Bookings Today', icon: 'event', href: '/bookings' },
  {
    key: 'revenueThisMonth',
    label: 'Revenue This Month',
    icon: 'account_balance_wallet',
    href: '/payments',
    format: (v) => `₹${Number(v).toLocaleString('en-IN')}`,
  },
];

const QUICK_LINKS = [
  { href: '/venues/new', icon: 'add_business', label: 'Add a venue', hint: 'Set up a new place to book' },
  { href: '/bookings', icon: 'event', label: 'All bookings', hint: 'Search and filter every booking' },
  { href: '/payments', icon: 'payments', label: 'Payments', hint: 'Money received at your venues' },
  { href: '/notifications', icon: 'notifications', label: 'Notifications', hint: 'Alerts and platform messages' },
];

/** "5 Nov, 1:00 pm": the day and hour of a booking, without seconds or the browser's US date order. */
function slotTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day}, ${time}`;
}

function OwnerAdminDashboard() {
  const { data, error, loading } = useFetch<Summary>('/owner/dashboard/summary');
  const recent = useFetch<RecentBooking[]>('/owner/bookings?limit=5');

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" subtitle="How your venues are doing at a glance." />
      {error && <ErrorBanner message={error} />}
      {(loading || data) && (
        <div className="grid grid-cols-2 gap-card-gap lg:grid-cols-4">
          {loading &&
            CARDS.map(({ key }) => (
              <Card key={key} className="h-28 animate-pulse">
                {null}
              </Card>
            ))}
          {data &&
            CARDS.map(({ key, label, icon, href, format }) => (
              <Link key={key} href={href} className="group block focus-visible:outline-none">
                <Card className="relative h-full overflow-hidden transition-shadow group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-primary/40">
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/5 transition-transform duration-500 group-hover:scale-150" />
                  <div className="relative z-10 mb-4 flex items-start justify-between">
                    <p className="font-label-md text-label-md uppercase text-on-surface-variant">{label}</p>
                    <Icon name={icon} className="text-primary" />
                  </div>
                  <h3 className="relative z-10 font-stat-lg text-stat-lg text-on-surface">
                    {format ? format(data[key]) : data[key]}
                  </h3>
                </Card>
              </Link>
            ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-body-md font-semibold text-on-surface">Recent bookings</h2>
            <Link href="/bookings" className="text-body-md font-medium text-primary hover:underline">
              View all →
            </Link>
          </div>
          {recent.error && <ErrorBanner message={recent.error} />}
          {recent.data && recent.data.length === 0 && <EmptyState message="No bookings yet." />}
          {recent.loading && <Card className="h-48 animate-pulse">{null}</Card>}
          {recent.data && recent.data.length > 0 && (
            <Card className="overflow-hidden p-0">
              <ul className="divide-y divide-outline-variant/20">
                {recent.data.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/bookings/${b.id}`}
                      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-surface-container-low/60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body-md font-medium text-on-surface">
                          {b.customer.name || b.customer.whatsappNumber || b.customer.email || 'Customer'}{b.isWalkIn && <span className="ml-1.5 rounded-full bg-surface-container px-1.5 py-0.5 align-middle text-[10px] font-semibold text-on-surface-variant">Walk-in</span>}
                          <span className="font-normal text-on-surface-variant"> · {b.venue.name}</span>
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {slotTime(b.startTime)} · <span className="font-mono">{b.orderId}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="hidden text-body-md sm:inline">
                          {b.currency} {b.amount}
                        </span>
                        <Badge value={b.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-body-md font-semibold text-on-surface">Quick actions</h2>
          <div className="space-y-2">
            {QUICK_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block">
                <Card className="flex items-center gap-3 p-4 transition-shadow hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed-dim/20">
                    <Icon name={l.icon} className="text-primary" />
                  </span>
                  <div>
                    <p className="text-body-md font-medium text-on-surface">{l.label}</p>
                    <p className="text-xs text-on-surface-variant">{l.hint}</p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Staff see today at their venue instead of organization-wide totals and revenue. */
function StaffDashboard() {
  const { user, selectedVenue } = useAuth();
  if (!selectedVenue) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={`Today at ${selectedVenue.name}`} subtitle="Every booking for the day, whatever its status." />
      <DayBookings key={selectedVenue.id} venueId={selectedVenue.id} />
      <div className="grid grid-cols-1 gap-card-gap sm:grid-cols-3">
        {[
          { href: '/walk-in', icon: 'edit_calendar', label: 'Walk-in booking', hint: 'Book a slot for a customer' },
          { href: '/bookings', icon: 'event', label: 'All bookings', hint: 'Search and filter every booking' },
          { href: '/notifications', icon: 'notifications', label: 'Notifications', hint: 'Alerts for your venues' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="block focus-visible:outline-none">
            <Card className="flex items-center gap-3 transition-shadow hover:shadow-md">
              <Icon name={l.icon} className="text-primary" />
              <span>
                <span className="block text-body-md font-semibold text-on-surface">{l.label}</span>
                <span className="block text-xs text-on-surface-variant">{l.hint}</span>
              </span>
            </Card>
          </Link>
        ))}
      </div>
      <AccessCard audience="staff" venues={user?.venues} />
    </div>
  );
}

export default function DashboardPage() {
  const { isStaff } = useAuth();
  return isStaff ? <StaffDashboard /> : <OwnerAdminDashboard />;
}
