'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Select, SkeletonTable } from '@/components/ui';

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

const STATUSES = ['', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

export default function RefundsPage() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useFetch<Refund[]>(
    `/admin/refunds?limit=100${status ? `&status=${status}` : ''}`,
  );

  return (
    <div>
      <PageHeader
        title="Refunds"
        action={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </Select>
        }
      />
      {loading && <SkeletonTable columns={7} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No refunds found." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
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
              {data.map((r) => (
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
                    <Link
                      href={`/bookings/${r.booking.id}`}
                      className="text-sm font-medium text-gray-900 hover:underline"
                    >
                      View Booking →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
