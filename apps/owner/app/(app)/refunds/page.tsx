'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, LoadingState, PageHeader, SearchInput, Select } from '@/components/ui';

interface Refund {
  id: string;
  status: string;
  originalAmount: string;
  originalCurrency: string;
  coinAmountCredited: string;
  reason: string | null;
  createdAt: string;
  booking: { orderId: string };
}

const STATUSES = ['', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];

export default function RefundsPage() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, loading } = useFetch<Refund[]>(
    `/owner/refunds?limit=100${status ? `&status=${status}` : ''}`,
  );

  const filtered = data?.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      r.booking.orderId.toLowerCase().includes(q) ||
      (r.reason ?? '').toLowerCase().includes(q)
    );
  });

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
      {data && data.length > 0 && (
        <SearchInput
          placeholder="Search by order or reason…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-md"
        />
      )}
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No refunds found." />}
      {filtered && filtered.length === 0 && data && data.length > 0 && (
        <EmptyState message="No refunds match your search." />
      )}
      {filtered && filtered.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Original Amount</th>
                <th className="px-4 py-3">Coins Credited</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-outline-variant/20 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{r.booking.orderId}</td>
                  <td className="px-4 py-3">
                    {r.originalCurrency} {r.originalAmount}
                  </td>
                  <td className="px-4 py-3">🪙 {r.coinAmountCredited}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{r.reason || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge value={r.status} />
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
