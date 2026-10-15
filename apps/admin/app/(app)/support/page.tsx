'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Select, SkeletonTable } from '@/components/ui';

interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  customer: { whatsappNumber: string; name: string | null };
}

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export default function SupportPage() {
  const [status, setStatus] = useState('');
  const { data, error, loading } = useFetch<Ticket[]>(
    `/admin/support-tickets?limit=100${status ? `&status=${status}` : ''}`,
  );

  return (
    <div>
      <PageHeader
        title="Support Tickets"
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
      {loading && <SkeletonTable columns={6} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No support tickets found." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.subject}</td>
                  <td className="px-4 py-3 text-gray-600">{t.category}</td>
                  <td className="px-4 py-3 text-gray-600">{t.customer.name || t.customer.whatsappNumber}</td>
                  <td className="px-4 py-3">{t.priority}</td>
                  <td className="px-4 py-3">
                    <Badge value={t.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/support/${t.id}`} className="text-sm font-medium text-gray-900 hover:underline">
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
