'use client';

import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { useAuth } from '@/lib/auth-context';
import { useListFilters } from '@/lib/use-list-filters';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { formatMoney, remainingAmount } from '@/lib/money';
import { Badge, ErrorBanner, PageHeader } from '@/components/ui';
import {
  DataTable,
  DateRangeFilter,
  FilterSelect,
  ListToolbar,
  Pagination,
  ROW,
  SearchBox,
} from '@/components/list-kit';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  paidAmount: string;
  currency: string;
  startTime: string;
  groundType: string;
  paymentMethod: string | null;
  venue: { name: string; facilityCode: string };
  /** A walk-in recorded by venue staff: its details are on the booking, not a customer account. */
  isWalkIn?: boolean;
  customer: { whatsappNumber: string | null; phoneVerified: boolean; email: string | null; name: string | null };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING_PAYMENT', label: 'Pending payment' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'NO_SHOW', label: 'No show' },
];

const METHOD_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'MONEY', label: 'Online' },
  { value: 'COINS', label: 'Coins' },
  { value: 'OFFLINE', label: 'Walk-in' },
];

export default function BookingsPage() {
  const f = useListFilters({ search: '', status: '', venueId: '', paymentMethod: '', from: '', to: '' });
  const { isStaff, selectedVenueId } = useAuth();
  const { data: venues } = useFetch<Array<{ id: string; name: string }>>('/venues/mine');
  // Staff work in one venue at a time: the header's venue always scopes their list (and replaces the venue filter).
  const query = isStaff && selectedVenueId ? `${f.query}${f.query ? '&' : ''}venueId=${selectedVenueId}` : f.query;
  const { rows, total, error, loading } = usePagedFetch<Booking>('/owner/bookings', query, f.page);

  const venueOptions = [
    { value: '', label: 'All' },
    ...(venues ?? []).map((v) => ({ value: v.id, label: v.name })),
  ];

  return (
    <div>
      <PageHeader title="Bookings" subtitle="Every booking made at your venues, online or walk-in." />
      <ListToolbar
        active={f.active}
        total={total}
        noun="booking"
        onClear={f.clear}
        search={
          <SearchBox
            label="Search bookings"
            placeholder="Search order, customer name or number, venue…"
            value={f.values.search}
            onChange={(v) => f.set('search', v)}
          />
        }
      >
        <FilterSelect label="Status" value={f.values.status} options={STATUS_OPTIONS} onChange={(v) => f.set('status', v)} />
        {!isStaff && venueOptions.length > 2 && (
          <FilterSelect label="Venue" value={f.values.venueId} options={venueOptions} onChange={(v) => f.set('venueId', v)} />
        )}
        <FilterSelect
          label="Paid by"
          value={f.values.paymentMethod}
          options={METHOD_OPTIONS}
          onChange={(v) => f.set('paymentMethod', v)}
        />
        <DateRangeFilter
          label="Played"
          from={f.values.from}
          to={f.values.to}
          onFrom={(v) => f.set('from', v)}
          onTo={(v) => f.set('to', v)}
        />
      </ListToolbar>

      {error && <ErrorBanner message={error} />}
      {!error && (
        <DataTable
          columns={['Order', 'Venue', 'Customer', 'Start', 'Total', 'Paid', 'Remaining', 'Status', { label: '', className: 'w-20' }]}
          loading={loading}
          rowCount={rows.length}
          empty={f.active ? 'No bookings match your search or filters.' : 'No bookings yet.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {rows.map((b) => (
            <tr key={b.id} className={ROW}>
              <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
              <td className="px-4 py-3">
                <p className="font-medium text-on-surface">{b.venue.name}</p>
                <p className="text-xs text-on-surface-variant">{b.groundType}</p>
              </td>
              <td className="px-4 py-3 text-on-surface-variant">{b.customer.name || b.customer.whatsappNumber || b.customer.email || 'Customer'}{b.isWalkIn && <span className="ml-1.5 rounded-full bg-surface-container px-1.5 py-0.5 align-middle text-[10px] font-semibold text-on-surface-variant">Walk-in</span>}</td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                {new Date(b.startTime).toLocaleString()}
              </td>
              <td className="whitespace-nowrap px-4 py-3">{formatMoney(b.currency, b.amount)}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatMoney(b.currency, b.paidAmount)}</td>
              <td
                className={`whitespace-nowrap px-4 py-3 ${
                  remainingAmount(b) > 0 && (b.status === 'CONFIRMED' || b.status === 'COMPLETED')
                    ? 'font-semibold text-error'
                    : 'text-on-surface-variant'
                }`}
              >
                {b.status === 'CANCELLED' || b.status === 'PENDING_PAYMENT' ? '—' : formatMoney(b.currency, remainingAmount(b))}
              </td>
              <td className="px-4 py-3">
                <Badge value={b.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/bookings/${b.id}`} className="text-sm font-medium text-primary hover:underline">
                  View →
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
