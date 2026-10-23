'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { formatMoney, remainingAmount } from '@/lib/money';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, LoadingState } from '@/components/ui';

export interface DayBooking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  paidAmount: string;
  currency: string;
  startTime: string;
  endTime: string;
  groundType: string;
  paymentMethod: string | null;
  quantity?: number | null;
  customer: { whatsappNumber: string | null; phoneVerified: boolean; email: string | null; name: string | null };
}

/** Today as a YYYY-MM-DD string in the browser's own calendar (the venue's, as everywhere in this portal). */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

function dayWindow(ymd: string): { from: string; to: string } {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return {
    from: new Date(y, m - 1, d).toISOString(),
    to: new Date(y, m - 1, d + 1).toISOString(),
  };
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const dayTitle = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const label = new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return ymd === todayYmd() ? `Today, ${label}` : label;
};

/**
 * One venue's bookings for one day, in start order, every status: pending, confirmed, completed,
 * cancelled and no-show. Used as the staff dashboard and as the Day view page.
 */
export function DayBookings({ venueId, initialDate }: { venueId: string; initialDate?: string }) {
  const [date, setDate] = useState(initialDate ?? todayYmd());
  const { from, to } = useMemo(() => dayWindow(date), [date]);
  const { data, error, loading } = useFetch<DayBooking[]>(
    `/owner/bookings/day?venueId=${venueId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of data ?? []) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" aria-label="Previous day" onClick={() => setDate((d) => shiftDay(d, -1))}>
            ←
          </Button>
          <Input
            type="date"
            aria-label="Day"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="!w-44"
          />
          <Button type="button" variant="secondary" aria-label="Next day" onClick={() => setDate((d) => shiftDay(d, 1))}>
            →
          </Button>
          {date !== todayYmd() && (
            <Button type="button" variant="secondary" onClick={() => setDate(todayYmd())}>
              Today
            </Button>
          )}
        </div>
        <div className="text-right">
          <p className="text-body-md font-semibold text-on-surface">{dayTitle(date)}</p>
          <p className="text-xs text-on-surface-variant">
            {data
              ? `${data.length} booking${data.length === 1 ? '' : 's'}`
              : loading
                ? 'Loading…'
                : ''}
            {Object.entries(counts).length > 1 &&
              ` · ${Object.entries(counts)
                .map(([s, n]) => `${n} ${s.replace('_', ' ').toLowerCase()}`)
                .join(', ')}`}
          </p>
        </div>
      </Card>

      {error && <ErrorBanner message={error} />}
      {loading && !data && <LoadingState />}
      {data && data.length === 0 && <EmptyState message="No bookings on this day." />}
      {data && data.length > 0 && (
        <ul className="space-y-2" aria-label="Bookings">
          {data.map((b) => (
            <li key={b.id}>
              <Link
                href={`/bookings/${b.id}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface-container-lowest px-4 py-3 shadow-sm ring-1 ring-outline-variant/20 transition-colors hover:ring-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="w-36 shrink-0">
                  <p className="text-body-md font-semibold text-on-surface">
                    {time(b.startTime)} – {time(b.endTime)}
                  </p>
                  <p className="text-xs text-on-surface-variant">{b.groundType || 'Unit'}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-md font-medium text-on-surface">
                    {b.customer.name || b.customer.whatsappNumber || b.customer.email || 'Customer'}
                  </p>
                  <p className="font-mono text-xs text-on-surface-variant">{b.orderId}</p>
                </div>
                <div className="whitespace-nowrap text-right text-body-md">
                  <p className="font-medium text-on-surface">{formatMoney(b.currency, b.amount)}</p>
                  {(b.status === 'CONFIRMED' || b.status === 'COMPLETED') && (
                    <p className="text-xs text-on-surface-variant">
                      Paid {formatMoney(b.currency, b.paidAmount)}
                      {remainingAmount(b) > 0 && (
                        <span className="font-semibold text-error"> · {formatMoney(b.currency, remainingAmount(b))} due</span>
                      )}
                    </p>
                  )}
                </div>
                <Badge value={b.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
