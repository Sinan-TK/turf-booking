'use client';

import Link from 'next/link';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { Pagination } from '@/components/pagination';
import { Badge, Card, EmptyState, ErrorBanner, SkeletonTable } from '@/components/ui';

interface Ticket {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  createdAt: string;
  customer: { whatsappNumber: string; name: string | null };
}

const PRIORITY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'REFUND_ISSUE', label: 'Refund issue' },
  { value: 'PAID_BUT_BOOKING_FAILED', label: 'Paid, booking failed' },
  { value: 'BOOKING_ISSUE', label: 'Booking issue' },
  { value: 'ACCOUNT_PROFILE_ISSUE', label: 'Account / profile' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export default function SupportPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', status: '', priority: '', category: '' });
  const { rows, total, error, loading } = usePagedFetch<Ticket>('/admin/support-tickets', query, page);

  return (
    <div>
      <ListSection
        title="Support"
        subtitle={loading && total === 0 ? 'undefined' : `${total} ticket${total === 1 ? '' : 's'}${active ? ' match your filters' : ' in total'}.`}
      >
        <ListToolbar
          search={
            <SearchBox
              value={values.search}
              onChange={(v) => set('search', v)}
              placeholder="Search by subject, customer, phone or order ID…"
              label="Search tickets"
            />
          }
          active={active}
          total={total}
          noun="ticket"
          onClear={clear}
        >
          <Dropdown label="Status" value={values.status} neutral="" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
          <Dropdown label="Priority" value={values.priority} neutral="" options={PRIORITY_OPTIONS} onChange={(v) => set('priority', v)} />
          <Dropdown label="Category" value={values.category} neutral="" options={CATEGORY_OPTIONS} onChange={(v) => set('category', v)} />
        </ListToolbar>
      </ListSection>

      {loading && rows.length === 0 && <SkeletonTable columns={6} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No support tickets found." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
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
              {rows.map((t) => (
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
