'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import { PAGE_SIZE, usePagedFetch } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { formatMoney } from '@/lib/money';
import { Badge, Card, EmptyState, ErrorBanner, Icon, PageHeader } from '@/components/ui';
import { DataTable, FilterSelect, Pagination, ROW, SearchBox, usePageSlice } from '@/components/list-kit';
import { FacilityIcon } from '@/components/facility-icon';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface Figures {
  bookings: number;
  /** Paid online by customers. */
  collected: string;
  /** Kept by the platform: commission, fees and its share of late cancellations. */
  platform: string;
  refunded: string;
  /** The owner's. */
  earned: string;
}
interface VenueRow extends Figures {
  id: string;
  name: string;
  facilities: number;
}
interface FacilityRow extends Figures {
  id: string;
  name: string;
  iconKey: string;
  iconSvg: string | null;
  venues: number;
}
interface Breakdown {
  total: Figures;
  byVenue: VenueRow[];
  byFacility: FacilityRow[];
}

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
  status: 'INITIATED' | 'PAID';
  reference: string | null;
  paidAt: string | null;
}

interface Line {
  id: string;
  kind: 'PLAYED' | 'NO_SHOW' | 'LATE_CANCEL';
  slotStart: string;
  currency: string;
  collected: string;
  refunded: string;
  platformAmount: string;
  ownerAmount: string;
  booking: { id: string; orderId: string };
  venue: { id: string; name: string };
  category: { id: string; name: string };
  payout: { id: string; status: 'INITIATED' | 'PAID' } | null;
}

const KIND: Record<Line['kind'], string> = { PLAYED: 'Played', NO_SHOW: 'No-show', LATE_CANCEL: 'Late cancellation' };
const KIND_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'PLAYED', label: 'Played' },
  { value: 'NO_SHOW', label: 'No-show' },
  { value: 'LATE_CANCEL', label: 'Late cancellation' },
];

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

type Period = 'month' | 'last' | '3m' | 'year' | 'all';
const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: '3m', label: 'Last 3 months' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
];

/** The period as the API's half-open [from, to) window, in the browser's own calendar. */
function periodParams(period: Period): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const win = (from: Date, to: Date) => `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  switch (period) {
    case 'month':
      return win(new Date(y, m, 1), new Date(y, m + 1, 1));
    case 'last':
      return win(new Date(y, m - 1, 1), new Date(y, m, 1));
    case '3m':
      return win(new Date(y, m - 2, 1), new Date(y, m + 1, 1));
    case 'year':
      return win(new Date(y, 0, 1), new Date(y + 1, 0, 1));
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const INR = 'INR';
const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
/** "2026-10" -> "October 2026". */
const monthName = (month: string) => new Date(`${month}-15T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
/** "1 Nov": the day the cap starts over. */
const resetDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'main' }) {
  return (
    <Card className={tone === 'main' ? 'bg-primary-container/40 ring-primary/20' : ''}>
      <p className="text-xs uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className={`mt-1 font-semibold ${tone === 'main' ? 'text-3xl text-primary' : 'text-2xl'}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-on-surface-variant">{note}</p>}
    </Card>
  );
}

/** A thin bar showing a share of the total, with the percentage beside it. */
function Share({ value, total }: { value: string; total: string }) {
  const pct = Number(total) > 0 ? Math.min(100, Math.round((Number(value) / Number(total)) * 100)) : 0;
  return (
    <div className="flex min-w-[7rem] items-center gap-2" role="img" aria-label={`${pct}% of your earnings`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-high">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs text-on-surface-variant">{pct}%</span>
    </div>
  );
}

function rateText(f: FacilityEarnings): string {
  if (f.capReached) return `No commission now: only a ${f.afterCapFeePercent}% payment fee`;
  if (!f.nextCommission) return '—';
  return f.nextCommission.type === 'PERCENTAGE' ? `${f.nextCommission.value}% of the booking price` : `₹${f.nextCommission.value} per booking`;
}

type Tab = 'venues' | 'facilities' | 'bookings' | 'payouts' | 'cap';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'venues', label: 'By venue' },
  { key: 'facilities', label: 'By facility' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'cap', label: 'Commission cap' },
];

const ROWS_PER_PAGE = 15;
const FACILITY_PAGE = 12;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EarningsPage() {
  const [period, setPeriod] = useState<Period>('month');
  const [tab, setTab] = useState<Tab>('venues');
  // The tab lives in the address (?tab=bookings), so a refresh or a shared link stays on it. Read in an effect, not with
  // useSearchParams, which would need a Suspense boundary around the page.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('tab');
    if (TABS.some((t) => t.key === wanted)) setTab(wanted as Tab);
  }, []);
  const choose = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'venues') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };

  const range = useMemo(() => periodParams(period), [period]);
  const breakdown = useFetch<Breakdown>(`/owner/earnings/breakdown${range ? `?${range}` : ''}`);
  const earnings = useFetch<Earnings>('/owner/earnings');

  // The bookings tab can be opened already filtered to a venue or facility, from the other tabs.
  const [preset, setPreset] = useState<{ venueId?: string; categoryId?: string } | null>(null);
  const showBookings = (p: { venueId?: string; categoryId?: string }) => {
    setPreset(p);
    choose('bookings');
  };

  const total = breakdown.data?.total;
  const periodLabel = PERIODS.find((p) => p.value === period)!.label.toLowerCase();

  return (
    <div>
      <PageHeader
        title="Earnings"
        subtitle="What your online bookings earn after the platform's commission, by venue and by facility, and when you are paid. Played bookings are paid weekly."
        action={
          <div className="w-44">
            <FilterSelect label="Show" value={period} options={PERIODS} onChange={setPeriod} />
          </div>
        }
      />
      {breakdown.error && <ErrorBanner message={breakdown.error} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat tone="main" label="You earned" value={total ? formatMoney(INR, total.earned) : '…'} note={`From ${total?.bookings ?? 0} booking${total?.bookings === 1 ? '' : 's'} ${periodLabel}`} />
        <Stat label="Paid online by customers" value={total ? formatMoney(INR, total.collected) : '…'} note="The advance, before any commission" />
        <Stat label="Kept by the platform" value={total ? formatMoney(INR, total.platform) : '…'} note="Commission and payment fees" />
        <Stat
          label="Waiting for the next payout"
          value={earnings.data ? formatMoney(INR, earnings.data.notYetInPayout.total) : '…'}
          note={earnings.data ? `${earnings.data.notYetInPayout.count} booking${earnings.data.notYetInPayout.count === 1 ? '' : 's'} · next payout ${date(earnings.data.nextPayoutOn)}` : undefined}
        />
      </div>
      {earnings.data && (
        <p className="mt-3 text-xs text-on-surface-variant">
          {formatMoney(INR, earnings.data.pendingPayouts.total)} in {earnings.data.pendingPayouts.count} payout
          {earnings.data.pendingPayouts.count === 1 ? '' : 's'} prepared, to be transferred to your bank.{' '}
          {earnings.data.lastPayout
            ? `Last payout ${formatMoney(INR, earnings.data.lastPayout.totalOwnerAmount)}${earnings.data.lastPayout.paidAt ? `, paid ${date(earnings.data.lastPayout.paidAt)}` : ''}.`
            : 'Nothing paid yet.'}
        </p>
      )}

      <div role="tablist" aria-label="Earnings sections" className="mb-5 mt-6 flex gap-1 overflow-x-auto border-b border-outline-variant/40">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`earnings-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="earnings-tabpanel"
            onClick={() => choose(t.key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="earnings-tabpanel" role="tabpanel" aria-labelledby={`earnings-tab-${tab}`}>
        {tab === 'venues' && <ByVenue data={breakdown.data} loading={breakdown.loading} onShow={(venueId) => showBookings({ venueId })} />}
        {tab === 'facilities' && <ByFacility data={breakdown.data} loading={breakdown.loading} onShow={(categoryId) => showBookings({ categoryId })} />}
        {tab === 'bookings' && <Bookings key={JSON.stringify(preset)} range={range} breakdown={breakdown.data} preset={preset} />}
        {tab === 'payouts' && <Payouts />}
        {tab === 'cap' && <CommissionCap data={earnings.data} error={earnings.error} loading={earnings.loading} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const FIGURE_COLUMNS = ['Bookings', 'Paid online', 'Platform kept', 'You earn', 'Share of earnings'];

function Figures({ r, total }: { r: Figures; total: string }) {
  return (
    <>
      <td className="px-4 py-3">{r.bookings}</td>
      <td className="whitespace-nowrap px-4 py-3">{formatMoney(INR, r.collected)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{formatMoney(INR, r.platform)}</td>
      <td className="whitespace-nowrap px-4 py-3 font-semibold text-primary">{formatMoney(INR, r.earned)}</td>
      <td className="px-4 py-3">
        <Share value={r.earned} total={total} />
      </td>
    </>
  );
}

function ByVenue({ data, loading, onShow }: { data: Breakdown | null; loading: boolean; onShow: (venueId: string) => void }) {
  const [q, setQ] = useState('');
  // Most earning first, so the venues that matter lead; those with nothing yet follow by name.
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.byVenue ?? [])
      .filter((v) => !term || v.name.toLowerCase().includes(term))
      .sort((a, b) => Number(b.earned) - Number(a.earned) || a.name.localeCompare(b.name));
  }, [data, q]);
  const page = usePageSlice(rows, ROWS_PER_PAGE, `${q}|${data?.total.earned}`);
  return (
    <>
      {(data?.byVenue.length ?? 0) > ROWS_PER_PAGE && (
        <div className="mb-3 max-w-md">
          <SearchBox label="Search venues" placeholder="Search venue…" value={q} onChange={setQ} />
        </div>
      )}
      <DataTable
        columns={['Venue', ...FIGURE_COLUMNS, '']}
        loading={loading && !data}
        rowCount={rows.length}
        empty={q ? 'No venue matches your search.' : 'Add a venue to see what it earns here.'}
        footer={<Pagination page={page.page} pageSize={ROWS_PER_PAGE} total={page.total} onPage={page.setPage} />}
      >
        {page.rows.map((v) => (
          <tr key={v.id} className={ROW}>
            <td className="px-4 py-3">
              <Link href={`/venues/${v.id}`} className="font-medium text-on-surface hover:text-primary hover:underline">
                {v.name}
              </Link>
              <p className="text-xs text-on-surface-variant">
                {v.facilities} facilit{v.facilities === 1 ? 'y' : 'ies'}
              </p>
            </td>
            <Figures r={v} total={data!.total.earned} />
            <td className="px-4 py-3 text-right">
              <button type="button" onClick={() => onShow(v.id)} className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-primary hover:underline">
                Bookings <Icon name="arrow_forward" className="!text-base" />
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}

function ByFacility({ data, loading, onShow }: { data: Breakdown | null; loading: boolean; onShow: (categoryId: string) => void }) {
  const rows = useMemo(
    () => [...(data?.byFacility ?? [])].sort((a, b) => Number(b.earned) - Number(a.earned) || a.name.localeCompare(b.name)),
    [data],
  );
  const page = usePageSlice(rows, ROWS_PER_PAGE, data?.total.earned);
  return (
    <DataTable
      columns={['Facility', ...FIGURE_COLUMNS, '']}
      loading={loading && !data}
      rowCount={rows.length}
      empty="Add a venue with bookable units to see what each facility earns."
      footer={<Pagination page={page.page} pageSize={ROWS_PER_PAGE} total={page.total} onPage={page.setPage} />}
    >
      {page.rows.map((f) => (
        <tr key={f.id} className={ROW}>
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-container/60 text-primary">
                <FacilityIcon iconKey={f.iconKey} iconSvg={f.iconSvg} className="text-[22px]" />
              </span>
              <div>
                <p className="font-medium text-on-surface">{f.name}</p>
                <p className="text-xs text-on-surface-variant">
                  in {f.venues} venue{f.venues === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          </td>
          <Figures r={f} total={data!.total.earned} />
          <td className="px-4 py-3 text-right">
            <button type="button" onClick={() => onShow(f.id)} className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-primary hover:underline">
              Bookings <Icon name="arrow_forward" className="!text-base" />
            </button>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}

function Bookings({ range, breakdown, preset }: { range: string; breakdown: Breakdown | null; preset: { venueId?: string; categoryId?: string } | null }) {
  const f = useListFilters({ search: '', venueId: preset?.venueId ?? '', categoryId: preset?.categoryId ?? '', kind: '' });
  const query = [f.query, range].filter(Boolean).join('&');
  // The filters start from the venue or facility the owner came from, so "filtered" means anything set, and clearing empties them all.
  const filtered = Object.values(f.values).some(Boolean);
  const clearAll = () => (Object.keys(f.values) as Array<keyof typeof f.values>).forEach((k) => f.set(k, ''));
  const { rows, total, error, loading } = usePagedFetch<Line>('/owner/earnings/settlements', query, f.page);
  const venueOptions = [{ value: '', label: 'All' }, ...(breakdown?.byVenue ?? []).map((v) => ({ value: v.id, label: v.name }))];
  const facilityOptions = [{ value: '', label: 'All' }, ...(breakdown?.byFacility ?? []).map((c) => ({ value: c.id, label: c.name }))];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1">
          <SearchBox label="Search earnings by order" placeholder="Search by order number…" value={f.values.search} onChange={(v) => f.set('search', v)} />
        </div>
        <FilterSelect label="Venue" value={f.values.venueId} options={venueOptions} onChange={(v) => f.set('venueId', v)} />
        <FilterSelect label="Facility" value={f.values.categoryId} options={facilityOptions} onChange={(v) => f.set('categoryId', v)} />
        <FilterSelect label="Type" value={f.values.kind} options={KIND_OPTIONS} onChange={(v) => f.set('kind', v)} />
        {filtered && (
          <button type="button" onClick={clearAll} className="text-sm font-medium text-primary hover:underline">
            Clear filters
          </button>
        )}
      </div>
      <p className="mb-2 text-xs text-on-surface-variant">
        {total} booking{total === 1 ? '' : 's'}
        {filtered ? ' match your filters' : ' in this period'}.
      </p>
      {error && <ErrorBanner message={error} />}
      {!error && (
        <DataTable
          columns={['Order', 'Venue', 'Facility', 'Slot', 'Type', 'Paid online', 'Platform kept', 'You earn', 'Payout']}
          loading={loading}
          rowCount={rows.length}
          empty={filtered ? 'No bookings match your filters.' : 'No settled bookings in this period yet.'}
          footer={<Pagination page={f.page} pageSize={PAGE_SIZE} total={total} onPage={f.setPage} />}
        >
          {rows.map((r) => (
            <tr key={r.id} className={ROW}>
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/bookings/${r.booking.id}`} className="text-primary hover:underline">
                  {r.booking.orderId}
                </Link>
              </td>
              <td className="px-4 py-3">{r.venue.name}</td>
              <td className="px-4 py-3 text-on-surface-variant">{r.category.name}</td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{date(r.slotStart)}</td>
              <td className="whitespace-nowrap px-4 py-3">{KIND[r.kind]}</td>
              <td className="whitespace-nowrap px-4 py-3">{formatMoney(r.currency, r.collected)}</td>
              <td className="whitespace-nowrap px-4 py-3 text-on-surface-variant">{formatMoney(r.currency, r.platformAmount)}</td>
              <td className="whitespace-nowrap px-4 py-3 font-semibold text-primary">{formatMoney(r.currency, r.ownerAmount)}</td>
              <td className="whitespace-nowrap px-4 py-3">
                {r.payout ? (
                  <Link href={`/earnings/${r.payout.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                    <Badge value={r.payout.status} />
                  </Link>
                ) : (
                  <span className="text-xs text-on-surface-variant">Next payout</span>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}

function Payouts() {
  const f = useListFilters({});
  const payouts = usePagedFetch<Payout>('/owner/payouts', f.query, f.page);
  return (
    <>
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
                <Badge value={p.status === 'PAID' ? 'PAID' : 'INITIATED'} />
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
    </>
  );
}

function CommissionCap({ data, error, loading }: { data: Earnings | null; error: string | null; loading: boolean }) {
  // An owner can have hundreds of facility cards (one per venue and facility): show them a dozen at a time.
  const [facilityQuery, setFacilityQuery] = useState('');
  const shown = useMemo(() => {
    const q = facilityQuery.trim().toLowerCase();
    return (data?.facilities ?? []).filter((fe) => !q || fe.venueName.toLowerCase().includes(q) || fe.facility.toLowerCase().includes(q));
  }, [data, facilityQuery]);
  const page = usePageSlice(shown, FACILITY_PAGE, facilityQuery);

  if (error) return <ErrorBanner message={error} />;
  if (loading && !data) return <div className="h-40 animate-pulse rounded-xl bg-surface-container-high" />;
  if (!data) return null;
  return (
    <>
      <h2 className="text-sm font-semibold">Commission cap this month, by venue and facility</h2>
      <p className="mb-3 mt-0.5 text-xs text-on-surface-variant">
        {data.facilities[0] ? `${monthName(data.facilities[0].month)}. ` : ''}The cap and the booking count that sets the commission rate are for the calendar month, not the payout
        week.
      </p>
      {data.facilities.length === 0 && <EmptyState message="Add a venue with bookable units to see its commission here." />}
      {data.facilities.length > FACILITY_PAGE && (
        <div className="mb-3 max-w-md">
          <SearchBox label="Search venues" placeholder="Search venue or facility…" value={facilityQuery} onChange={setFacilityQuery} />
        </div>
      )}
      {data.facilities.length > 0 && shown.length === 0 && <EmptyState message="No venue or facility matches your search." />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {page.rows.map((fe) => {
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
        <Pagination page={page.page} pageSize={FACILITY_PAGE} total={page.total} onPage={page.setPage} />
      </div>
    </>
  );
}
