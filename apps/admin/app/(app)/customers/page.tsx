'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { Card, EmptyState, ErrorBanner, Input, PageHeader, SkeletonTable } from '@/components/ui';

interface Customer {
  id: string;
  whatsappNumber: string;
  name: string | null;
  email: string | null;
  status: string;
  createdAt: string;
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const { data, error, loading } = useFetch<Customer[]>(
    `/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`,
  );

  return (
    <div>
      <PageHeader
        title="Customers"
        action={
          <Input
            placeholder="Search phone, name, or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
        }
      />
      {loading && <SkeletonTable columns={5} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No customers found." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">WhatsApp Number</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{c.whatsappNumber}</td>
                  <td className="px-4 py-3">{c.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/customers/${c.id}`} className="text-sm font-medium text-gray-900 hover:underline">
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
