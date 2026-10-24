'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useFetch } from '@/lib/use-fetch';
import { api, ApiError } from '@/lib/api';
import { formatMoney, remainingAmount } from '@/lib/money';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge, Button, Card, ErrorBanner, LoadingState, PageHeader, SuccessBanner } from '@/components/ui';

interface Payment {
  id: string;
  provider: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
}
interface Refund {
  id: string;
  status: string;
  coinAmountCredited: string;
  createdAt: string;
}
interface BookingDetail {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  /** Charged online to hold the slot. */
  advanceAmount: string;
  /** Collected so far (online advance and anything recorded at the venue). */
  paidAmount: string;
  currency: string;
  startTime: string;
  endTime: string;
  groundType: string;
  paymentMethod: string | null;
  cancellationReasonCode: string | null;
  cancellationNote: string | null;
  venue: { name: string; facilityCode: string };
  /** A walk-in recorded by venue staff: its details are on the booking, not a customer account. */
  isWalkIn?: boolean;
  customer: { whatsappNumber: string | null; phoneVerified: boolean; email: string | null; name: string | null };
  payments: Payment[];
  refunds: Refund[];
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: booking, error, loading, refetch } = useFetch<BookingDetail>(`/owner/bookings/${id}`);
  const [collecting, setCollecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function collect() {
    setBusy(true);
    setCollectError(null);
    try {
      await api.post(`/owner/bookings/${id}/collect`, {});
      setCollecting(false);
      setNotice('Balance recorded as received.');
      refetch();
    } catch (err) {
      setCollectError(err instanceof ApiError ? err.message : 'Could not record this payment');
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    setBusy(true);
    setCancelError(null);
    try {
      await api.post(`/owner/bookings/${id}/cancel`, { reason: cancelReason.trim() || undefined });
      setCancelling(false);
      setCancelReason('');
      setNotice('Booking cancelled. The customer has been refunded in coins.');
      refetch();
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Could not cancel this booking');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorBanner message={error} />;
  if (!booking) return null;
  const canCancel = booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT';

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: '/bookings', label: 'All bookings' }} title={`Booking ${booking.orderId}`} />
      {notice && <SuccessBanner message={notice} />}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Badge value={booking.status} />
          {canCancel && (
            <Button type="button" variant="secondary" onClick={() => setCancelling(true)}>
              Cancel this booking
            </Button>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-on-surface-variant">Venue</dt>
            <dd>
              {booking.venue.name} ({booking.venue.facilityCode})
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Customer</dt>
            <dd>
              {booking.customer.name || booking.customer.whatsappNumber || booking.customer.email || 'Customer'}{booking.isWalkIn && <span className="ml-1.5 rounded-full bg-surface-container px-1.5 py-0.5 align-middle text-[10px] font-semibold text-on-surface-variant">Walk-in</span>}
              {booking.customer.name && booking.customer.whatsappNumber && (
                <span className="block text-xs text-on-surface-variant">
                  {booking.customer.whatsappNumber}
                  {!booking.customer.phoneVerified && !booking.isWalkIn && ' (number not verified)'}
                </span>
              )}
              {booking.customer.email && <span className="block text-xs text-on-surface-variant">{booking.customer.email}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Time</dt>
            <dd>
              {new Date(booking.startTime).toLocaleString()} – {new Date(booking.endTime).toLocaleTimeString()}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Booked</dt>
            <dd>{booking.groundType}</dd>
          </div>
          <div className="col-span-1 sm:col-span-2">
            <dt className="mb-1 text-on-surface-variant">Payment</dt>
            <dd>
              <dl className="grid grid-cols-3 gap-3 rounded-lg bg-surface-container-low p-3">
                <div>
                  <dt className="text-xs text-on-surface-variant">Total</dt>
                  <dd className="font-semibold">{formatMoney(booking.currency, booking.amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-on-surface-variant">Paid</dt>
                  <dd className="font-semibold">{formatMoney(booking.currency, booking.paidAmount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-on-surface-variant">Remaining</dt>
                  <dd className={`font-semibold ${remainingAmount(booking) > 0 ? 'text-error' : 'text-on-surface'}`}>
                    {formatMoney(booking.currency, remainingAmount(booking))}
                  </dd>
                </div>
              </dl>
              {Number(booking.advanceAmount) > 0 && (
                <p className="mt-1 text-xs text-on-surface-variant">
                  {formatMoney(booking.currency, booking.advanceAmount)} was charged online to hold the slot.
                </p>
              )}
              {remainingAmount(booking) > 0 && (booking.status === 'CONFIRMED' || booking.status === 'COMPLETED') && (
                <div className="mt-3">
                  <Button type="button" onClick={() => setCollecting(true)}>
                    Record balance received
                  </Button>
                </div>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-on-surface-variant">Payment Method</dt>
            <dd>{booking.paymentMethod || '—'}</dd>
          </div>
          {booking.cancellationReasonCode && (
            <div className="col-span-2">
              <dt className="text-on-surface-variant">Cancellation</dt>
              <dd>
                {booking.cancellationReasonCode}
                {booking.cancellationNote ? ` — ${booking.cancellationNote}` : ''}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-on-surface">Payments</h2>
        {booking.payments.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {booking.payments.map((p) => (
                  <tr key={p.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">{p.provider}</td>
                    <td className="py-2">
                      {p.currency} {p.amount}
                    </td>
                    <td className="py-2">
                      <Badge value={p.status} />
                    </td>
                    <td className="py-2 text-on-surface-variant">{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-on-surface">Refunds</h2>
        {booking.refunds.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No refunds.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <tbody>
                {booking.refunds.map((r) => (
                  <tr key={r.id} className="border-b border-outline-variant/20 last:border-0">
                    <td className="py-2">🪙 {r.coinAmountCredited} Coins</td>
                    <td className="py-2">
                      <Badge value={r.status} />
                    </td>
                    <td className="py-2 text-on-surface-variant">{new Date(r.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {cancelling && (
        <ConfirmDialog
          title="Cancel this booking?"
          confirmLabel="Yes, cancel it"
          tone="danger"
          busy={busy}
          error={cancelError}
          onConfirm={cancelBooking}
          onCancel={() => setCancelling(false)}
        >
          <p>
            {Number(booking.advanceAmount) > 0 && booking.status === 'CONFIRMED'
              ? `The customer gets all ${formatMoney(booking.currency, booking.advanceAmount)} they paid online back as coins, and the slot becomes free again. You earn nothing from this booking.`
              : 'The slot becomes free again. Nothing was paid online, so there is nothing to refund.'}
          </p>
          <label htmlFor="cancel-reason" className="mt-3 block text-xs font-medium text-on-surface-variant">
            Reason (shown to the customer)
          </label>
          <input
            id="cancel-reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            maxLength={500}
            placeholder="e.g. Heavy rain, ground closed"
            className="mt-1 w-full rounded-lg border border-outline-variant/50 bg-surface-container-lowest px-3 py-2 text-sm"
          />
        </ConfirmDialog>
      )}
      {collecting && (
        <ConfirmDialog
          title="Record balance received?"
          confirmLabel="Yes, received"
          busy={busy}
          error={collectError}
          onConfirm={collect}
          onCancel={() => setCollecting(false)}
        >
          The customer paid the remaining {formatMoney(booking.currency, remainingAmount(booking))} at the venue.
        </ConfirmDialog>
      )}
    </div>
  );
}
