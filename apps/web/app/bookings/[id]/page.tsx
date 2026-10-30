'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { trustedMapsUrl } from '@/lib/maps';
import { LoginGate } from '@/components/login-gate';
import { Badge, Button, Card, ErrorBanner, SuccessBanner } from '@/components/ui';
import { DetailSkeleton } from '@/components/skeleton';
import { Screen } from '@/components/screen';
import { CancellationTerms, useCancellationPreview } from '@/components/cancellation-terms';

interface Booking {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  /** Charged online to hold the slot. */
  advanceAmount?: string;
  /** Paid so far (the advance, plus anything paid at the venue). */
  paidAmount?: string;
  currency: string;
  startTime: string;
  endTime: string;
  groundType: string;
  paymentMethod: string | null;
  /** How many were booked (a pooled item, like kayaks); 1 for a single unit. */
  quantity?: number;
  venue: { id: string; name: string; address: string; facilityCode: string; googleMapsUrl: string | null; lat: number; lng: number };
  /** The unit (a court, a pitch) or the pooled item that was booked. */
  resourceName: string | null;
  /** The kind of venue it is: "Badminton Court", with what one bookable unit is called ("Court"). */
  facility: { name: string; unitLabel: string } | null;
}

/** Directions to the venue: its own Google Maps link when it has one, else a pin at its coordinates. */
function directionsLink(venue: Booking['venue']): string {
  const own = trustedMapsUrl(venue.googleMapsUrl);
  if (own) return own;
  if (Number.isFinite(venue.lat) && Number.isFinite(venue.lng) && (venue.lat !== 0 || venue.lng !== 0)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;
}

const minutesLabel = (m: number) => (m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`);

function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const { refresh } = useCustomer();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelResultMessage, setCancelResultMessage] = useState<string | null>(null);

  function load() {
    api
      .get<Booking>(`/me/bookings/${id}`)
      .then(setBooking)
      .catch((err) => {
        // An expired session sends the visitor back to the login prompt.
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
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
  const preview = useCancellationPreview(id, booking?.status);

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {!error && !booking && <DetailSkeleton />}
      {booking && (
        <Card>
          {cancelResultMessage && (
            <div className="mb-4">
              <SuccessBanner message={cancelResultMessage} />
            </div>
          )}
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-500">Order {booking.orderId}</p>
              <h2 className="mt-0.5 text-lg font-semibold text-gray-900">{booking.venue.name}</h2>
              <p className="text-xs text-gray-500">{booking.venue.address}</p>
              <a
                href={directionsLink(booking.venue)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs font-medium text-brand-700 underline underline-offset-2 hover:text-brand-600"
              >
                Get directions
              </a>
            </div>
            <Badge value={booking.status} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">When</dt>
              <dd className="text-right">
                {new Date(booking.startTime).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                <span className="block font-medium text-gray-900">
                  {new Date(booking.startTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                  {new Date(booking.endTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} (
                  {minutesLabel(Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60_000))})
                </span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Booked</dt>
              <dd className="text-right">
                <span className="font-medium text-gray-900">
                  {booking.quantity && booking.quantity > 1 ? `${booking.quantity} × ` : ''}
                  {booking.resourceName ?? booking.facility?.name ?? 'Your slot'}
                  {booking.groundType ? ` · ${booking.groundType}` : ''}
                </span>
                {booking.facility && booking.resourceName && <span className="block text-xs text-gray-500">{booking.facility.name}</span>}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Amount</dt>
              <dd>
                {booking.currency} {booking.amount}
              </dd>
            </div>
            {Number(booking.paidAmount) > 0 && Number(booking.paidAmount) < Number(booking.amount) && booking.status === 'CONFIRMED' && (
              <>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Paid</dt>
                  <dd>
                    {booking.currency} {booking.paidAmount}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Pay at the venue</dt>
                  <dd className="font-semibold text-gray-900">
                    {booking.currency} {(Number(booking.amount) - Number(booking.paidAmount)).toFixed(2)}
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Payment Method</dt>
              <dd>{booking.paymentMethod ?? '—'}</dd>
            </div>
          </dl>

          {cancellable && !cancelResultMessage && preview && preview.windows.length > 0 && booking.status === 'CONFIRMED' && (
            <CancellationTerms preview={preview} />
          )}

          {cancellable && !cancelResultMessage && preview && !preview.canCancel && (
            <p className="mt-4 text-center text-sm text-gray-600">
              This booking can no longer be cancelled. If something has gone wrong, contact the venue or{' '}
              <a href="/support" className="font-medium text-gray-900 underline">
                our support
              </a>
              .
            </p>
          )}

          {cancellable && !cancelResultMessage && (!preview || preview.canCancel) && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              {!confirmingCancel ? (
                <Button variant="danger" className="w-full" onClick={() => setConfirmingCancel(true)}>
                  Cancel Booking
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-center text-xs text-gray-500">
                    {booking.status !== 'CONFIRMED'
                      ? "This booking hasn't been paid yet — cancelling releases the slot with no charge."
                      : preview?.now
                        ? preview.now.refundPercent === 0
                          ? 'Cancelling now returns no Coins.'
                          : `Cancelling now returns ${preview.now.refundCoins} Coins (${preview.now.refundPercent}% of what you paid).`
                        : "You'll receive Coins back based on the cancellation policy."}
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
    </>
  );
}

export default function BookingDetailPage() {
  return (
    <Screen>
      <h1 className="mb-6 text-center text-xl font-semibold text-gray-900">Booking Details</h1>
      <LoginGate message="Log in to see this booking.">
        <BookingDetail />
      </LoginGate>
    </Screen>
  );
}
