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

interface Refund {
  id: string;
  status: string;
  originalAmount: string;
  originalCurrency: string;
  coinAmountCredited: string;
  reason: string | null;
  createdAt: string;
  booking: { id: string; orderId: string };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
];

export default function RefundsPage() {
  const f = useListFilters({ search: '', status: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Refund>('/owner/refunds', f.query, f.page);

  return (
    <div>
      <PageHeader title="Refunds" subtitle="Cancelled bookings returned to customers as coins." />
      <ListToolbar
        active={f.active}
        total={total}
        noun="refund"
        onClear={f.clear}
        search={
          <SearchBox
            label="Search refunds"
            placeholder="Search order, reason, customer…"
            value={f.values.search}
            onChange={(v) => f.set('search', v)}
          />
        }
      >
        <FilterSelect label="Status" value={f.values.status} options={STATUS_OPTIONS} onChange={(v) => f.set('status', v)} />
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
          columns={['Order', 'Original amount', 'Coins credited', 'Reason', 'Status', 'Date']}
          loading={loading}
          rowCount={rows.length}
          empty={f.active ? 'No refunds match your search or filters.' : 'No refunds yet.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {rows.map((r) => (
            <tr key={r.id} className={ROW}>
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/bookings/${r.booking.id}`} className="text-primary hover:underline">
                  {r.booking.orderId}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {r.originalCurrency} {r.originalAmount}
              </td>
              <td className="whitespace-nowrap px-4 py-3">🪙 {r.coinAmountCredited}</td>
              <td className="px-4 py-3 text-on-surface-variant">{r.reason || '—'}</td>
              <td className="px-4 py-3">
                <Badge value={r.status} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">
                {new Date(r.createdAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
