'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { useAccountData } from '@/lib/account-cache';
import { Badge, Card, CategoryIcon, ErrorBanner } from '@/components/ui';
import { formatPrice } from '@/lib/booking';
import { BookingRowsSkeleton } from '@/components/skeleton';

interface Facility {
  name: string;
  iconKey: string;
  iconSvg: string | null;
  unitLabel: string;
}

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  endTime: string;
  quantity: number;
  groundType: string;
  venue?: { name: string; address: string };
  resource?: { name: string; category: Facility } | null;
  resourceGroup?: { name: string; category: Facility } | null;
}

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const MONTH = new Intl.DateTimeFormat(undefined, { month: 'short' });
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "6:00 – 7:30 PM" style range, in the visitor's own time. */
function timeRange(startIso: string, endIso: string): string {
  return `${CLOCK.format(new Date(startIso))} – ${CLOCK.format(new Date(endIso))}`;
}

/** The customer's bookings, newest first. Shown as a tab on the account page. */
export function BookingsPanel() {
  // The last answer paints at once; the live one replaces it.
  const { data: bookings, error } = useAccountData('bookings', () => api.get<Booking[]>('/me/bookings'), 'Something went wrong.');

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {!error && !bookings && <BookingRowsSkeleton />}
      {!error && bookings && bookings.length === 0 && (
        <Card>
          <p className="mb-4 text-center text-sm text-gray-500">No bookings yet.</p>
          <Link href="/explore" className="block text-center text-sm font-medium text-brand-700 hover:underline">
            Find a venue
          </Link>
        </Card>
      )}
      {!error && bookings && bookings.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {bookings.map((b) => (
            <li key={b.id} className="h-full">
              <BookingRow booking={b} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One booking: the whole row opens it (checkout while payment is pending, the booking page otherwise). */
function BookingRow({ booking: b }: { booking: Booking }) {
  const start = new Date(b.startTime);
  const item = b.resource ?? b.resourceGroup ?? null;
  const facility = item?.category;
  const what = item ? (b.resourceGroup && b.quantity > 1 ? `${b.quantity} × ${item.name}` : item.name) : b.groundType;
  const pending = b.status === 'PENDING_PAYMENT';
  return (
    <Link
      href={pending || b.status === 'PROCESSING' ? `/checkout/${b.id}` : `/bookings/${b.id}`}
      className="group flex h-full flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-gray-100 text-gray-900">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500">{WEEKDAY.format(start)}</span>
          <span className="text-xl font-bold leading-none">{start.getDate()}</span>
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500">{MONTH.format(start)}</span>
        </div>
        <Badge value={b.status} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{b.venue?.name ?? b.orderId}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-600">
          {facility && <CategoryIcon iconKey={facility.iconKey} iconSvg={facility.iconSvg} className="shrink-0 text-[0.95rem] text-gray-500" />}
          <span className="truncate">{what}</span>
        </p>
        <p className="mt-0.5 text-xs text-gray-500">{timeRange(b.startTime, b.endTime)}</p>
        <p className="mt-0.5 text-[0.7rem] text-gray-400">{b.orderId}</p>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        {pending && <span className="text-xs font-semibold text-brand-700">Pay now</span>}
        <p className="ml-auto text-sm font-semibold text-gray-900">{formatPrice({ amount: b.amount, currency: b.currency })}</p>
      </div>
    </Link>
  );
}
