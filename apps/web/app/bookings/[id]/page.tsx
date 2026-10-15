'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Badge, Button, Card, ErrorBanner, LoadingState, Screen, SuccessBanner } from '@/components/ui';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  startTime: string;
  endTime: string;
  groundType: string;
  paymentMethod: string | null;
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelResultMessage, setCancelResultMessage] = useState<string | null>(null);

  function load() {
    api
      .get<Booking>(`/me/bookings/${id}`)
      .then(setBooking)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'));
  }

  useEffect(load, [id]);

  async function onConfirmCancel() {
    setCancelling(true);
    setError(null);
    try {
      const result = await api.post<{
        booking: Booking;
        refund: { coinAmountCredited: string } | null;
      }>(`/me/bookings/${id}/cancel`, {});
      setBooking(result.booking);
      setCancelResultMessage(
        result.refund
          ? `Booking cancelled. ${result.refund.coinAmountCredited} Coins credited to your wallet.`
          : 'Booking cancelled.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this booking.');
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  const cancellable = booking && ['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status);

  return (
    <Screen>
      <h1 className="mb-6 text-center text-xl font-semibold text-gray-900">Booking Details</h1>
      {error && <ErrorBanner message={error} />}
      {!error && !booking && <LoadingState />}
      {booking && (
        <Card>
          {cancelResultMessage && (
            <div className="mb-4">
              <SuccessBanner message={cancelResultMessage} />
            </div>
          )}
          <div className="mb-4 flex items-center justify-between">
            <p className="font-semibold text-gray-900">{booking.orderId}</p>
            <Badge value={booking.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">When</dt>
              <dd>
                {new Date(booking.startTime).toLocaleString()} –{' '}
                {new Date(booking.endTime).toLocaleTimeString()}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Ground Type</dt>
              <dd>{booking.groundType}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Amount</dt>
              <dd>
                {booking.currency} {booking.amount}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Payment Method</dt>
              <dd>{booking.paymentMethod ?? '—'}</dd>
            </div>
          </dl>

          {cancellable && !cancelResultMessage && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              {!confirmingCancel ? (
                <Button variant="danger" className="w-full" onClick={() => setConfirmingCancel(true)}>
                  Cancel Booking
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-center text-xs text-gray-500">
                    {booking.status === 'CONFIRMED'
                      ? "You'll receive Coins back based on the cancellation policy."
                      : "This booking hasn't been paid yet — cancelling releases the slot with no charge."}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      disabled={cancelling}
                      onClick={() => setConfirmingCancel(false)}
                    >
                      Keep Booking
                    </Button>
                    <Button
                      variant="danger"
                      className="flex-1"
                      disabled={cancelling}
                      onClick={onConfirmCancel}
                    >
                      {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </Screen>
  );
}
