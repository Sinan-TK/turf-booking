'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, LoadingState, PageHeader, SearchInput, Select } from '@/components/ui';

interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  gatewayPaymentId: string | null;
  createdAt: string;
  booking: { orderId: string };
}

const STATUSES = ['', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'];

export default function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, loading } = useFetch<Payment[]>(
    `/owner/payments?limit=100${status ? `&status=${status}` : ''}`,
  );

  const filtered = data?.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      p.booking.orderId.toLowerCase().includes(q) ||
      p.provider.toLowerCase().includes(q) ||
      (p.gatewayPaymentId ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Payments"
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
          placeholder="Search by order, provider, or payment ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-md"
        />
      )}
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No payments found." />}
      {filtered && filtered.length === 0 && data && data.length > 0 && (
        <EmptyState message="No payments match your search." />
      )}
      {filtered && filtered.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-outline-variant/20 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{p.booking.orderId}</td>
                  <td className="px-4 py-3">{p.provider}</td>
                  <td className="px-4 py-3">
                    {p.currency} {p.amount}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={p.status} />
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{new Date(p.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
