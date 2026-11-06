'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAccountData } from '@/lib/account-cache';
import { Badge, Card, CategoryIcon, ErrorBanner } from '@/components/ui';
import { formatPrice } from '@/lib/booking';
import { BookingRowsSkeleton, LoadingNote, Skeleton } from '@/components/skeleton';

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

/** How many bookings each load brings (the first screenful, then the same again every time the end of the list is scrolled to). */
const PAGE = 12;

/** The customer's bookings, newest first, a page at a time: more are added below as the list is scrolled. Shown as a tab on the account page. */
export function BookingsPanel() {
  // The first page paints at once from the last answer; the live one replaces it.
  const { data: first, error } = useAccountData(
    'bookings-pages',
    async () => {
      const page = await api.getPage<Booking[]>(`/me/bookings?limit=${PAGE}&offset=0`);
      return { rows: page.data, total: page.total ?? page.data.length };
    },
    'Something went wrong.',
  );
  // The pages after the first, and how many there are in all.
  const [more, setMore] = useState<Booking[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const firstRows = first?.rows;
  useEffect(() => {
    // A fresh first page (the live answer, or a return to the tab) starts the list again from the top.
    setMore([]);
    setMoreError(null);
  }, [firstRows]);

  const bookings = first ? [...first.rows, ...more.filter((m) => !first.rows.some((r) => r.id === m.id))] : null;
  const total = first?.total ?? 0;
  const hasMore = !!bookings && bookings.length < total;

  const loadMore = useCallback(async () => {
    if (!bookings || loadingMore || bookings.length >= total) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.getPage<Booking[]>(`/me/bookings?limit=${PAGE}&offset=${bookings.length}`);
      setMore((cur) => [...cur, ...page.data]);
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : 'Could not load more bookings.');
    } finally {
      setLoadingMore(false);
    }
  }, [bookings, loadingMore, total]);

  // Scrolling near the end loads the next page. The watcher is set up again after every load, so it also fires straight away
  // when the list is still too short to fill the screen.
  const endOfList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = endOfList.current;
    if (!el || !hasMore || loadingMore || moreError) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px 0px' },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [hasMore, loadingMore, moreError, bookings?.length, loadMore]);

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
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {bookings.map((b) => (
              <li key={b.id} className="h-full">
                <BookingRow booking={b} />
              </li>
            ))}
            {/* The next ones load into the same grid: cards of the same shape while they come. */}
            {loadingMore && (
              <>
                <LoadingNote label="Loading more bookings" />
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={`more-${i}`} aria-hidden="true" className="h-full">
                    <div className="flex h-full flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <Skeleton className="h-16 w-14 rounded-xl" />
                        <Skeleton className="h-5 w-24 rounded-full" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                        <Skeleton className="h-3 w-2/3" />
                        <Skeleton className="h-2.5 w-1/3" />
                      </div>
                      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    </div>
                  </li>
                ))}
              </>
            )}
          </ul>
          {hasMore && <div ref={endOfList} aria-hidden="true" className="h-px" />}
          {moreError && (
            <div className="mt-3 text-center">
              <p className="text-sm text-red-600">{moreError}</p>
              <button type="button" onClick={() => void loadMore()} className="mt-1 text-sm font-semibold text-brand-700 underline underline-offset-2">
                Try again
              </button>
            </div>
          )}
          {!hasMore && bookings.length > PAGE && <p className="mt-4 text-center text-xs text-gray-400">That is all your bookings.</p>}
        </>
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
