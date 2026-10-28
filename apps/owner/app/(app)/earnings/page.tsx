'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, ErrorBanner, Icon, PageHeader } from '@/components/ui';
import { DataTable, Pagination, ROW, SearchBox, usePageSlice } from '@/components/list-kit';

interface FacilityEarnings {
  venueId: string;
  venueName: string;
  categoryId: string;
  facility: string;
  month: string;
  /** When this month ends: the cap and the commission tiers start over then. */
  resetsOn: string;
  bookings: number;
  commission: string;
  monthlyCommissionCap: string | null;
  capRemaining: string | null;
  capReached: boolean;
  nextCommission: { type: 'PERCENTAGE' | 'FLAT'; value: number } | null;
  afterCapFeePercent: number;
}

interface Earnings {
  facilities: FacilityEarnings[];
  notYetInPayout: { count: number; total: string };
  pendingPayouts: { count: number; total: string };
  lastPayout: { totalOwnerAmount: string; paidAt: string | null; periodEnd: string } | null;
  nextPayoutOn: string;
}

interface Payout {
  id: string;
  periodEnd: string;
  currency: string;
  totalOwnerAmount: string;
  settlementCount: number;
  status: 'PENDING' | 'PAID';
  reference: string | null;
  paidAt: string | null;
}

const INR = 'INR';
const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
/** "2026-10" -> "October 2026". */
const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
/** "1 Nov": the day the cap starts over. */
const resetDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function rateText(f: FacilityEarnings): string {
  if (f.capReached) return `No commission now: only a ${f.afterCapFeePercent}% payment fee`;
  if (!f.nextCommission) return '—';
  return f.nextCommission.type === 'PERCENTAGE' ? `${f.nextCommission.value}% of the booking price` : `₹${f.nextCommission.value} per booking`;
}

const FACILITY_PAGE = 12;

export default function EarningsPage() {
  const { data, error, loading } = useFetch<Earnings>('/owner/earnings');
  const f = useListFilters({});
  const payouts = usePagedFetch<Payout>('/owner/payouts', f.query, f.page);
  // An owner can have hundreds of facility cards (one per venue and facility): show them a dozen at a time.
  const [facilityQuery, setFacilityQuery] = useState('');
  const shownFacilities = useMemo(() => {
    const q = facilityQuery.trim().toLowerCase();
    return (data?.facilities ?? []).filter((fe) => !q || fe.venueName.toLowerCase().includes(q) || fe.facility.toLowerCase().includes(q));
  }, [data, facilityQuery]);
  const facilityPage = usePageSlice(shownFacilities, FACILITY_PAGE, facilityQuery);

  return (
    <div>
      <PageHeader
        title="Earnings"
        subtitle="What your online bookings earn after the platform's commission, and when you are paid. Played bookings are paid weekly."
      />
      {error && <ErrorBanner message={error} />}
      {loading && !data && <div className="h-40 animate-pulse rounded-xl bg-surface-container-high" />}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Waiting for the next payout</p>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(INR, data.notYetInPayout.total)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {data.notYetInPayout.count} booking{data.notYetInPayout.count === 1 ? '' : 's'} · next payout {date(data.nextPayoutOn)}
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Payout on its way</p>
              <p className="mt-1 text-2xl font-semibold">{formatMoney(INR, data.pendingPayouts.total)}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {data.pendingPayouts.count} payout{data.pendingPayouts.count === 1 ? '' : 's'} prepared, to be transferred to your bank
              </p>
            </Card>
            <Card>
              <p className="text-xs uppercase tracking-wide text-on-surface-variant">Last payout</p>
              {data.lastPayout ? (
                <>
                  <p className="mt-1 text-2xl font-semibold">{formatMoney(INR, data.lastPayout.totalOwnerAmount)}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">Paid {data.lastPayout.paidAt ? date(data.lastPayout.paidAt) : ''}</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-on-surface-variant">Nothing paid yet.</p>
              )}
            </Card>
          </div>

          <h2 className="mt-8 text-sm font-semibold">This month, by facility</h2>
          <p className="mb-3 mt-0.5 text-xs text-on-surface-variant">
            {data.facilities[0] ? `${monthName(data.facilities[0].month)}. ` : ''}The commission cap and the booking count for commission rates are for the calendar month, not the payout week.
          </p>
          {data.facilities.length === 0 && <EmptyState message="Add a venue with bookable units to see its earnings here." />}
          {data.facilities.length > FACILITY_PAGE && (
            <div className="mb-3 max-w-md">
              <SearchBox label="Search venues" placeholder="Search venue or facility…" value={facilityQuery} onChange={setFacilityQuery} />
            </div>
          )}
          {data.facilities.length > 0 && shownFacilities.length === 0 && <EmptyState message="No venue or facility matches your search." />}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {facilityPage.rows.map((fe) => {
              const cap = fe.monthlyCommissionCap === null ? null : Number(fe.monthlyCommissionCap);
              const used = Number(fe.commission);
              const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
              return (
                <Card key={`${fe.venueId}-${fe.categoryId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{fe.facility}</p>
                      <p className="text-xs text-on-surface-variant">{fe.venueName}</p>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      {fe.bookings} played booking{fe.bookings === 1 ? '' : 's'}
                    </p>
                  </div>
                  <p className="mt-3 text-sm">
                    Commission so far: <span className="font-semibold">{formatMoney(INR, fe.commission)}</span>
                    {cap !== null && <span className="text-on-surface-variant"> of {formatMoney(INR, cap)} cap</span>}
                  </p>
                  {cap !== null && (
                    <div className="mt-2" role="progressbar" aria-label="Commission cap used" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
                        <div className={`h-full rounded-full ${fe.capReached ? 'bg-secondary' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant">
                        {fe.capReached ? 'Cap reached: the rest of this month costs only the payment fee.' : `${formatMoney(INR, fe.capRemaining ?? 0)} until the cap.`}{' '}
                        Starts over on {resetDay(fe.resetsOn)}.
                      </p>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-on-surface-variant">Next booking: {rateText(fe)}</p>
                </Card>
              );
            })}
          </div>
          <div className="mt-3 overflow-hidden rounded-lg">
            <Pagination page={facilityPage.page} pageSize={FACILITY_PAGE} total={facilityPage.total} onPage={facilityPage.setPage} />
          </div>
        </>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold">Payouts</h2>
      {payouts.error && <ErrorBanner message={payouts.error} />}
      {!payouts.error && (
        <DataTable
          columns={['Slots played before', 'Bookings', 'Amount', 'Status', 'Paid on', 'Reference', '']}
          loading={payouts.loading}
          rowCount={payouts.rows.length}
          empty="No payouts yet. The first one is prepared after your first played booking."
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={payouts.total} onPage={f.setPage} />}
        >
          {payouts.rows.map((p) => (
            <tr key={p.id} className={ROW}>
              <td className="whitespace-nowrap px-4 py-3">{date(p.periodEnd)}</td>
              <td className="px-4 py-3">{p.settlementCount}</td>
              <td className="whitespace-nowrap px-4 py-3 font-medium">{formatMoney(p.currency, p.totalOwnerAmount)}</td>
              <td className="px-4 py-3">
                <Badge value={p.status === 'PAID' ? 'PAID' : 'PENDING'} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{p.paidAt ? date(p.paidAt) : '—'}</td>
              <td className="px-4 py-3 font-mono text-xs">{p.reference ?? '—'}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/earnings/${p.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  Statement <Icon name="arrow_forward" className="!text-base" />
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
