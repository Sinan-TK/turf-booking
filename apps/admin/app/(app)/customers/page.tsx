'use client';

import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Pagination } from '@/components/pagination';
import { Badge, Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

interface Customer {
  id: string;
  whatsappNumber: string;
  name: string | null;
  email: string | null;
  status: string;
  createdAt: string;
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'BLOCKED', label: 'Blocked' },
];

export default function CustomersPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', status: '' });
  const { rows, total, error, loading } = usePagedFetch<Customer>('/admin/customers', query, page);

  return (
    <div>
      <ListSection
        title="Customers"
        subtitle={loading && total === 0 ? 'Everyone who has booked or signed in.' : `${total} customer${total === 1 ? '' : 's'}${active ? ' match your filters' : ''}.`}
      >
        <ListToolbar
          search={
            <SearchBox
              value={values.search}
              onChange={(v) => set('search', v)}
              placeholder="Search by phone, name or email…"
              label="Search customers"
            />
          }
          active={active}
          total={total}
          noun="customer"
          onClear={clear}
        >
          <Dropdown label="Status" value={values.status} neutral="" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
        </ListToolbar>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={6} />}
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
                <th className="px-4 py-3">Status</th>
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
                  <td className="px-4 py-3">
                    <Badge value={c.status} />
                  </td>
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
