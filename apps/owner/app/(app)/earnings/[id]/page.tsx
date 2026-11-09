'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { formatMoney } from '@/lib/money';
import { Badge, Card, ErrorBanner, PageHeader } from '@/components/ui';
import { DataTable, Pagination, ROW, usePageSlice } from '@/components/list-kit';

interface Settlement {
  id: string;
  kind: 'PLAYED' | 'NO_SHOW' | 'LATE_CANCEL';
  slotStart: string;
  currency: string;
  collected: string;
  commission: string;
  fee: string;
  refunded: string;
  ownerAmount: string;
  booking: { id: string; orderId: string };
  venue: { name: string };
  category: { name: string };
}

interface PayoutDetail {
  id: string;
  periodEnd: string;
  currency: string;
  totalOwnerAmount: string;
  settlementCount: number;
  status: 'INITIATED' | 'PAID';
  reference: string | null;
  paidAt: string | null;
  settlements: Settlement[];
}

const KIND: Record<Settlement['kind'], string> = {
  PLAYED: 'Played',
  NO_SHOW: 'No-show (advance kept)',
  LATE_CANCEL: 'Late cancellation (your share)',
};

/** One payout's statement: every booking in it, what was paid online, the commission and what you get. */
export default function PayoutStatementPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useFetch<PayoutDetail>(`/owner/payouts/${id}`);
  // A statement lists every booking in the payout, which can be hundreds: 25 at a time.
  const lines = usePageSlice(data?.settlements ?? [], 25, '');

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface-container-high" />;

  return (
    <div>
      <Link href="/earnings" className="mb-3 inline-block text-sm text-on-surface-variant hover:text-on-surface">
        ← Earnings
      </Link>
      <PageHeader
        title={formatMoney(data.currency, data.totalOwnerAmount)}
        subtitle={`${data.settlementCount} booking${data.settlementCount === 1 ? '' : 's'} with slots before ${new Date(data.periodEnd).toLocaleDateString('en-IN', { dateStyle: 'long' })}.`}
      />
      <Card className="mb-6">
        <Badge value={data.status} />
        {data.status === 'PAID' && (
          <p className="mt-2 text-sm text-on-surface-variant">
            Transferred {data.paidAt ? new Date(data.paidAt).toLocaleString('en-IN') : ''} · bank reference <span className="font-mono">{data.reference}</span>
          </p>
        )}
        {data.status === 'INITIATED' && <p className="mt-2 text-sm text-on-surface-variant">Prepared; the transfer to your bank is on its way.</p>}
      </Card>
      <DataTable
        columns={['Slot', 'Order', 'Venue · facility', 'What happened', 'Paid online', 'Commission & fee', 'Coins back to customer', 'You get']}
        loading={false}
        rowCount={data.settlements.length}
        empty="No bookings in this payout."
        footer={<Pagination page={lines.page} pageSize={25} total={lines.total} onPage={lines.setPage} />}
      >
        {lines.rows.map((s) => (
          <tr key={s.id} className={ROW}>
            <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{new Date(s.slotStart).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            <td className="px-4 py-3 font-mono text-xs">
              <Link href={`/bookings/${s.booking.id}`} className="text-primary hover:underline">
                {s.booking.orderId}
              </Link>
            </td>
            <td className="px-4 py-3">
              {s.venue.name} · {s.category.name}
            </td>
            <td className="px-4 py-3">{KIND[s.kind]}</td>
            <td className="whitespace-nowrap px-4 py-3">{formatMoney(s.currency, s.collected)}</td>
            <td className="whitespace-nowrap px-4 py-3">{formatMoney(s.currency, Number(s.commission) + Number(s.fee))}</td>
            <td className="whitespace-nowrap px-4 py-3">{formatMoney(s.currency, s.refunded)}</td>
            <td className="whitespace-nowrap px-4 py-3 font-semibold">{formatMoney(s.currency, s.ownerAmount)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
