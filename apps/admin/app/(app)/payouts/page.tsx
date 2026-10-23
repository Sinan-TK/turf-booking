'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { money } from '@/lib/commercial';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { ListToolbar } from '@/components/list-toolbar';
import { Pagination } from '@/components/pagination';
import { Badge, Button, Card, EmptyState, ErrorBanner, SkeletonTable, StatCard, SuccessBanner } from '@/components/ui';

interface Payout {
  id: string;
  organization: { id: string; name: string };
  periodEnd: string;
  currency: string;
  totalOwnerAmount: string;
  settlementCount: number;
  status: 'PENDING' | 'PAID';
  reference: string | null;
  paidAt: string | null;
}

interface Summary {
  coinsOutstanding: string;
  platformEarningsThisMonth: string;
  commissionThisMonth: string;
  feesThisMonth: string;
  pendingPayouts: { count: number; total: string };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'To pay' },
  { value: 'PAID', label: 'Paid' },
];

export default function PayoutsPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ status: '' });
  const { rows, total, error, loading, refetch } = usePagedFetch<Payout>('/admin/payouts', query, page);
  const summary = useFetch<Summary>('/admin/payouts/summary');
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  async function runNow() {
    setRunning(true);
    setRunError(null);
    setNotice(null);
    try {
      const r = await api.post<{ completed: number; settled: number; payouts: number }>('/admin/payouts/run', {});
      setNotice(`Completed ${r.completed} booking(s), settled ${r.settled}, ${r.payouts} payout(s) prepared.`);
      refetch();
      summary.refetch();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : 'Could not run the payout preparation');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <ListSection
        title="Owner payouts"
        subtitle="Prepared every week for the slots played before the payout day. Pay each owner by bank transfer, then mark it paid with the transfer reference."
      >
        <ListToolbar search={null} active={active} total={total} noun="payout" onClear={clear}>
          <Dropdown label="Status" value={values.status} neutral="" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
          <Button type="button" variant="secondary" loading={running} onClick={runNow}>
            Prepare payouts now
          </Button>
        </ListToolbar>
      </ListSection>

      {summary.data && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Payouts to pay" icon="rupee" tone="amber" value={`${summary.data.pendingPayouts.count} · ${money(summary.data.pendingPayouts.total)}`} />
          <StatCard label="Platform earnings this month" icon="card" tone="brand" value={money(summary.data.platformEarningsThisMonth)} />
          <StatCard label="Commission this month" icon="refund" tone="sky" value={money(summary.data.commissionThisMonth)} />
          <StatCard label="Coins customers hold" icon="users" tone="violet" value={money(summary.data.coinsOutstanding)} />
        </div>
      )}
      {notice && (
        <div className="mb-4">
          <SuccessBanner message={notice} />
        </div>
      )}
      {runError && (
        <div className="mb-4">
          <ErrorBanner message={runError} />
        </div>
      )}

      {loading && rows.length === 0 && <SkeletonTable columns={6} />}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && total === 0 && <EmptyState message="No payouts yet. They appear once played bookings have been settled." />}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Slots played before</th>
                <th className="px-4 py-3">Bookings</th>
                <th className="px-4 py-3">To pay the owner</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 transition-colors last:border-0 hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-medium">{p.organization.name}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(p.periodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
                  <td className="px-4 py-3">{p.settlementCount}</td>
                  <td className="px-4 py-3">{money(p.totalOwnerAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge value={p.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/payouts/${p.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      {p.status === 'PENDING' ? 'Review & pay →' : 'View →'}
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
