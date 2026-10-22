'use client';

import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { DateRangeFilter, ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { Pagination } from '@/components/pagination';
import { Badge, Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  venue: { name: string; facilityCode: string };
  customer: { whatsappNumber: string; name: string | null };
}

const PAYMENT_METHOD_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'MONEY', label: 'Money' },
  { value: 'COINS', label: 'Coins' },
  { value: 'OFFLINE', label: 'Offline' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING_PAYMENT', label: 'Pending payment' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'NO_SHOW', label: 'No show' },
];

export default function BookingsPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', status: '', paymentMethod: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Booking>('/admin/bookings', query, page);

  return (
    <div>
      <ListSection
        title="Bookings"
        subtitle={loading && total === 0 ? '' : `${total} booking${total === 1 ? '' : 's'}${active ? ' match your filters' : ' on the platform'}.`}
      >
        <ListToolbar
          search={
            <SearchBox
              value={values.search}
              onChange={(v) => set('search', v)}
              placeholder="Search by order ID, customer, phone or venue…"
              label="Search bookings"
            />
          }
          active={active}
          total={total}
          noun="booking"
          onClear={clear}
        >
          <Dropdown label="Status" value={values.status} neutral="" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
          <Dropdown label="Payment" value={values.paymentMethod} neutral="" options={PAYMENT_METHOD_OPTIONS} onChange={(v) => set('paymentMethod', v)} />
          <DateRangeFilter
            label="Starts"
            from={values.from}
            to={values.to}
            onFrom={(v) => set('from', v)}
            onTo={(v) => set('to', v)}
          />
        </ListToolbar>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={7} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No bookings found." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Venue</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
                  <td className="px-4 py-3">{b.venue.name}</td>
                  <td className="px-4 py-3 text-gray-600">{b.customer.name || b.customer.whatsappNumber}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(b.startTime).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {b.currency} {b.amount}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/bookings/${b.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
