'use client';

import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { DateRangeFilter, ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { Pagination } from '@/components/pagination';
import { Badge, Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

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
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', status: '', from: '', to: '' });
  const { rows, total, error, loading } = usePagedFetch<Refund>('/admin/refunds', query, page);

  return (
    <div>
      <ListSection
        title="Refunds"
        subtitle={loading && total === 0 ? 'undefined' : `${total} refund${total === 1 ? '' : 's'}${active ? ' match your filters' : ' on the platform'}.`}
      >
        <ListToolbar
          search={
            <SearchBox
              value={values.search}
              onChange={(v) => set('search', v)}
              placeholder="Search by order ID, reason, customer or phone…"
              label="Search refunds"
            />
          }
          active={active}
          total={total}
          noun="refund"
          onClear={clear}
        >
          <Dropdown label="Status" value={values.status} neutral="" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
          <DateRangeFilter
            label="Date"
            from={values.from}
            to={values.to}
            onFrom={(v) => set('from', v)}
            onTo={(v) => set('to', v)}
          />
        </ListToolbar>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={7} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No refunds found." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Original Amount</th>
                <th className="px-4 py-3">Coins Credited</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{r.booking.orderId}</td>
                  <td className="px-4 py-3">
                    {r.originalCurrency} {r.originalAmount}
                  </td>
                  <td className="px-4 py-3">🪙 {r.coinAmountCredited}</td>
                  <td className="px-4 py-3 text-gray-600">{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge value={r.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/bookings/${r.booking.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      View Booking →
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
