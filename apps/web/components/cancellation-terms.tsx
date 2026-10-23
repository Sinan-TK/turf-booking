'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface CancellationPreview {
  canCancel: boolean;
  currency: string;
  paidOnline: string;
  /** What cancelling right now returns as coins; null when nothing was paid or cancelling is closed. */
  now: { refundPercent: number; refundCoins: string } | null;
  windows: Array<{ until: string; refundPercent: number }>;
  closesAt: string;
}

/** Loads the cancellation rules of a booking: the windows as times, when they close, and what cancelling now returns. */
export function useCancellationPreview(bookingId: string, reloadKey?: unknown): CancellationPreview | null {
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .get<CancellationPreview>(`/me/bookings/${bookingId}/cancellation`)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [bookingId, reloadKey]);
  return preview;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "Cancellation: full refund in coins until Fri 4:00 PM, 30% until Fri 9:00 PM, then no cancelling". */
export function CancellationTerms({ preview }: { preview: CancellationPreview }) {
  return (
    <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
      <p className="mb-1 font-medium text-gray-800">Cancelling</p>
      <ul className="space-y-0.5">
        {preview.windows.map((w, i) => (
          <li key={i}>
            Until {when(w.until)}: {w.refundPercent === 100 ? 'full refund' : w.refundPercent === 0 ? 'no refund' : `${w.refundPercent}% back`} as coins
          </li>
        ))}
        <li>From {when(preview.closesAt)}: the booking can&apos;t be cancelled.</li>
      </ul>
      <p className="mt-1.5 text-gray-500">Refunds are always paid as coins you can use on your next booking.</p>
    </div>
  );
}
