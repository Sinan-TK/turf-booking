'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { Pagination } from '@/components/pagination';
import { Badge, Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

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

export default function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { rows, total, error, loading } = usePagedFetch<Payment>(
    '/admin/payments',
    status ? `status=${status}` : '',
    page,
  );

  return (
    <div>
      <ListSection
        title="Payments"
        subtitle={loading && total === 0 ? 'Every payment on the platform.' : `${total} payment${total === 1 ? '' : 's'}${status ? ' match this filter' : ' on the platform'}.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Dropdown
            label="Status"
            value={status}
            neutral=""
            options={STATUS_OPTIONS}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
        </div>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={7} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No payments found." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Gateway Payment ID</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{p.booking.orderId}</td>
                  <td className="px-4 py-3">{p.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{p.gatewayPaymentId || '—'}</td>
                  <td className="px-4 py-3">
                    {p.currency} {p.amount}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={p.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/bookings/${p.booking.id}`} className="text-sm font-medium text-gray-900 hover:underline">
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
