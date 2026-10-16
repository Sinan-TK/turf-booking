'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { Icon } from '@/components/icons';
import { ListSection, FilterSummary } from '@/components/list-section';
import { Pagination } from '@/components/pagination';
import { Card, EmptyState, ErrorBanner, Input, SkeletonTable } from '@/components/ui';

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
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  // The directory is searched on the server; wait for a pause in typing.
  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const { rows, total, error, loading } = usePagedFetch<Customer>(
    '/admin/customers',
    debounced ? `search=${encodeURIComponent(debounced)}` : '',
    page,
  );

  return (
    <div>
      <ListSection
        title="Customers"
        subtitle={loading && total === 0 ? 'Everyone who has booked or signed in.' : `${total} customer${total === 1 ? '' : 's'}${debounced ? ' match your search' : ''}.`}
      >
        <div className="relative max-w-xl">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            type="search"
            placeholder="Search by phone, name or email…"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-9"
          />
        </div>
        {debounced && (
          <FilterSummary
            shown={total}
            total={total}
            noun="customers"
            onClear={() => {
              setSearch('');
              setDebounced('');
              setPage(1);
            }}
          />
        )}
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={5} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No customers found." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
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
              {rows.map((c) => (
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
