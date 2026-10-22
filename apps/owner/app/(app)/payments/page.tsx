'use client';

import Link from 'next/link';
import { useListFilters } from '@/lib/use-list-filters';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
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

interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  gatewayPaymentId: string | null;
  createdAt: string;
  booking: { id: string; orderId: string };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REFUNDED', label: 'Refunded' },
];

const PROVIDER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'RAZORPAY', label: 'Razorpay' },
  { value: 'COINS', label: 'Coins' },
];

export default function PaymentsPage() {
  const f = useListFilters({ search: '', status: '', provider: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Payment>('/owner/payments', f.query, f.page);

  return (
    <div>
      <PageHeader title="Payments" subtitle="Money and coins received for bookings at your venues." />
      <ListToolbar
        active={f.active}
        total={total}
        noun="payment"
        onClear={f.clear}
        search={
          <SearchBox
            label="Search payments"
            placeholder="Search order, payment ID, customer…"
            value={f.values.search}
            onChange={(v) => f.set('search', v)}
          />
        }
      >
        <FilterSelect label="Status" value={f.values.status} options={STATUS_OPTIONS} onChange={(v) => f.set('status', v)} />
        <FilterSelect
          label="Provider"
          value={f.values.provider}
          options={PROVIDER_OPTIONS}
          onChange={(v) => f.set('provider', v)}
        />
        <DateRangeFilter
          label="Date"
          from={f.values.from}
          to={f.values.to}
          onFrom={(v) => f.set('from', v)}
          onTo={(v) => f.set('to', v)}
        />
      </ListToolbar>

      {error && <ErrorBanner message={error} />}
      {!error && (
        <DataTable
          columns={['Order', 'Provider', 'Amount', 'Status', 'Date']}
          loading={loading}
          rowCount={rows.length}
          empty={f.active ? 'No payments match your search or filters.' : 'No payments yet.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {rows.map((p) => (
            <tr key={p.id} className={ROW}>
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/bookings/${p.booking.id}`} className="text-primary hover:underline">
                  {p.booking.orderId}
                </Link>
              </td>
              <td className="px-4 py-3">{p.provider}</td>
              <td className="whitespace-nowrap px-4 py-3">
                {p.currency} {p.amount}
              </td>
              <td className="px-4 py-3">
                <Badge value={p.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                {new Date(p.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
