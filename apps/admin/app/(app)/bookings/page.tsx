'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Select, SkeletonTable } from '@/components/ui';

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

const STATUSES = ['', 'PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'];

export default function BookingsPage() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useFetch<Booking[]>(
    `/admin/bookings?limit=100${status ? `&status=${status}` : ''}`,
  );

  return (
    <div>
      <PageHeader
        title="Bookings"
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
      {data && data.length === 0 && <EmptyState message="No bookings found." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
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
              {data.map((b) => (
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
        </Card>
      )}
    </div>
  );
}
