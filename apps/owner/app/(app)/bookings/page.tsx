'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, LoadingState, PageHeader, SearchInput, Select } from '@/components/ui';

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
  const [search, setSearch] = useState('');
  const { data, error, loading } = useFetch<Booking[]>(
    `/owner/bookings?limit=100${status ? `&status=${status}` : ''}`,
  );

  const filtered = data?.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      b.orderId.toLowerCase().includes(q) ||
      b.venue.name.toLowerCase().includes(q) ||
      (b.customer.name ?? '').toLowerCase().includes(q) ||
      b.customer.whatsappNumber.toLowerCase().includes(q)
    );
  });

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
      {data && data.length > 0 && (
        <SearchInput
          placeholder="Search by order, venue, or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-md"
        />
      )}
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No bookings found." />}
      {filtered && filtered.length === 0 && data && data.length > 0 && (
        <EmptyState message="No bookings match your search." />
      )}
      {filtered && filtered.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low text-xs uppercase text-on-surface-variant">
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
              {filtered.map((b) => (
                <tr key={b.id} className="border-b border-outline-variant/20 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{b.orderId}</td>
                  <td className="px-4 py-3">{b.venue.name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{b.customer.name || b.customer.whatsappNumber}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{new Date(b.startTime).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {b.currency} {b.amount}
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
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
