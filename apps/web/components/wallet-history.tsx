'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/booking';
import { ErrorBanner, Icon } from '@/components/ui';
import { RowsSkeleton } from '@/components/skeleton';

export interface WalletRow {
  id: string;
  type: string;
  amount: string;
  /** null for a recharge that is not credited yet */
  balanceAfter: string | null;
  createdAt: string;
  bookingId?: string | null;
  /** COMPLETED (it moved the balance), PENDING (waiting for the bank), FAILED or EXPIRED (never credited) */
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'EXPIRED';
}

const PAGE_SIZE = 8;

const TYPE_LABELS: Record<string, string> = {
  BOOKING_REWARD: 'Booking reward',
  REFUND: 'Cancellation refund',
  REFERRAL: 'Referral bonus',
  PROMOTION: 'Promotion',
  BOOKING_REDEMPTION: 'Used for a booking',
  ADMIN_ADJUSTMENT: 'Adjustment',
  WALLET_TOPUP: 'Added to wallet',
};
const labelFor = (type: string) => TYPE_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** How a row looks: green for Coins in, red for Coins out, yellow while waiting, grey when it never happened. */
function look(row: WalletRow) {
  if (row.status === 'PENDING') return { tile: 'bg-yellow-100 text-yellow-700', amount: 'text-yellow-700', icon: 'schedule', sign: '', chip: 'Pending', chipClass: 'bg-yellow-100 text-yellow-800' };
  if (row.status === 'FAILED' || row.status === 'EXPIRED') {
    return { tile: 'bg-gray-100 text-gray-500', amount: 'text-gray-400 line-through', icon: 'close', sign: '', chip: row.status === 'FAILED' ? 'Failed' : 'Not completed', chipClass: 'bg-gray-100 text-gray-600' };
  }
  const credit = Number(row.amount) >= 0;
  return credit
    ? { tile: 'bg-green-100 text-green-700', amount: 'text-green-700', icon: 'arrow_down_left', sign: '+', chip: null, chipClass: '' }
    : { tile: 'bg-red-100 text-red-700', amount: 'text-red-700', icon: 'arrow_up_right', sign: '−', chip: null, chipClass: '' };
}

/**
 * The wallet's history: one card per movement, Coins in green, Coins out in red, a recharge still waiting for the bank in yellow, a page
 * at a time. `refreshKey` changes when the wallet changes (after a recharge), so the list is read again.
 */
export function WalletHistory({ currency, refreshKey }: { currency: string; refreshKey: number }) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<WalletRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getPage<WalletRow[]>(`/me/coins/transactions?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      .then((res) => {
        if (!live) return;
        setRows(res.data);
        setTotal(res.total ?? res.data.length);
        setError(null);
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Could not load your history.'));
    return () => {
      live = false;
    };
  }, [page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // After a change the last page can disappear; step back onto one that exists.
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);

  if (error) return <ErrorBanner message={error} />;
  if (!rows) return <RowsSkeleton count={4} label="Loading your history…" />;
  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center">
        <Icon name="coin" className="mx-auto mb-2 text-[2.5rem]" />
        <p className="text-sm font-medium text-gray-700">No Coin history yet.</p>
        <p className="text-xs text-gray-500">Add money, or get Coins back when you cancel a booking.</p>
      </div>
    );
  }

  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, from + rows.length - 1);

  return (
    <section aria-label="Coin history">
      <ul className="space-y-2">
        {rows.map((t) => {
          const v = look(t);
          const inner = (
            <>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${v.tile}`}>
                <Icon name={v.icon} className="text-[1.25rem]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-semibold text-gray-900">{labelFor(t.type)}</span>
                  {v.chip && <span className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${v.chipClass}`}>{v.chip}</span>}
                </span>
                <span className="block text-xs text-gray-500">
                  {new Date(t.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={`block text-base font-bold ${v.amount}`}>
                  {v.sign}
                  {formatPrice({ amount: String(Math.abs(Number(t.amount))), currency })}
                </span>
                {t.balanceAfter !== null && <span className="block text-[0.6875rem] text-gray-400">Balance {formatPrice({ amount: t.balanceAfter, currency })}</span>}
              </span>
            </>
          );
          const cls = 'flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3';
          return (
            <li key={t.id}>
              {t.bookingId ? (
                <Link href={`/bookings/${t.bookingId}`} className={`${cls} transition hover:border-gray-300 hover:bg-gray-50`}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>

      {pages > 1 && (
        <nav aria-label="History pages" className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <p className="text-center text-xs text-gray-500" aria-live="polite">
            {from}–{to} of {total}
            <span className="block text-[0.6875rem] text-gray-400">
              Page {page + 1} of {pages}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1}
            className="rounded-xl border border-gray-200 px-3.5 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
