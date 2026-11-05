'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { trustedMapsUrl } from '@/lib/maps';
import { LoginGate } from '@/components/login-gate';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  ErrorBanner,
  Icon,
  SuccessBanner,
} from '@/components/ui';
import { BookingDetailSkeleton } from '@/components/skeleton';
import { AccountMenu } from '@/components/account-menu';
import { BackButton } from '@/components/back-button';
import { formatPrice } from '@/lib/booking';
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
  /** How it was paid online: exactly one of the two is above zero once the booking is confirmed. */
  coinsPaid?: string;
  moneyPaid?: string;
  createdAt?: string;
  processingUntil?: string | null;
  cancelledAt?: string | null;
  cancellationReasonCode?: string | null;
  cancellationNote?: string | null;
  /** The unit's main photo (or the pooled item's). */
  photoUrl?: string | null;
  /** How many were booked (a pooled item, like kayaks); 1 for a single unit. */
  quantity?: number;
  venue: {
    id: string;
    name: string;
    address: string;
    /** The venue's number, only for a confirmed booking. */
    contactPhone?: string | null;
    facilityCode: string;
    googleMapsUrl: string | null;
    lat: number;
    lng: number;
    photoUrl?: string | null;
  };
  /** The unit (a court, a pitch) or the pooled item that was booked. */
  resourceName: string | null;
  /** The kind of venue it is: "Badminton Court", with what one bookable unit is called ("Court"). */
  facility: { name: string; unitLabel: string; iconKey?: string; iconSvg?: string | null } | null;
}

/** Directions to the venue: its own Google Maps link when it has one, else a pin at its coordinates. */
function directionsLink(venue: Booking['venue']): string {
  const own = trustedMapsUrl(venue.googleMapsUrl);
  if (own) return own;
  if (
    Number.isFinite(venue.lat) &&
    Number.isFinite(venue.lng) &&
    (venue.lat !== 0 || venue.lng !== 0)
  ) {
    return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;
}

const minutesLabel = (m: number) =>
  m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`;

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

  // A payment still being confirmed: ask the server (which asks the gateway) every few seconds until it settles.
  const processing = booking?.status === 'PROCESSING';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      api
        .get(`/payments/sync/${id}`)
        .catch(() => undefined)
        .finally(load);
    }, 4000);
    return () => clearInterval(timer);
  }, [processing, id]);

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
      {!error && !booking && <BookingDetailSkeleton />}
      {booking && BookingBody()}
    </>
  );

  function BookingBody() {
    if (!booking) return null;
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    const amount = Number(booking.amount);
    const paid = Number(booking.paidAmount ?? 0);
    const advance = Number(booking.advanceAmount ?? 0);
    const money = (n: number | string) =>
      formatPrice({ amount: String(n), currency: booking.currency });
    const when = (iso: string) =>
      new Date(iso).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    const picture = booking.photoUrl ?? booking.venue.photoUrl ?? null;
    const what = `${booking.quantity && booking.quantity > 1 ? `${booking.quantity} × ` : ''}${booking.resourceName ?? booking.facility?.name ?? 'Your slot'}`;
    const cancelledWhy =
      booking.status === 'CANCELLED' && booking.cancellationReasonCode
        ? CANCEL_REASONS[booking.cancellationReasonCode]
        : null;
    const toPayAtVenue = booking.status === 'CONFIRMED' && paid < amount ? amount - paid : 0;
    const countdown = booking.status === 'CONFIRMED' ? startsIn(start, end) : null;
    const termsShown = !!preview && preview.windows.length > 0 && booking.status === 'CONFIRMED';

    return (
      <div className="space-y-4">
        {cancelResultMessage && <SuccessBanner message={cancelResultMessage} />}
        {booking.status === 'PROCESSING' && (
          <div role="status" className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
            <p className="font-semibold">Payment received, confirming…</p>
            <p>
              We are waiting for the bank to confirm your payment. Your slot is kept for you, and this page updates by itself
              {booking.processingUntil ? ` (we check until ${new Date(booking.processingUntil).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })})` : ''}.
            </p>
          </div>
        )}
        {booking.status === 'FAILED' && (
          <ErrorBanner message="We could not confirm your payment, so the slot was released. If money was deducted it returns to your bank automatically, usually within a few days. If it does not, contact support with your order number." />
        )}

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                {/* A small picture (the venue-type icon when there is no photo), not a banner. */}
                <div className="w-full shrink-0 overflow-hidden rounded-xl sm:h-36 sm:w-auto sm:max-w-full sm:self-start">
                  {picture ? (
                    <Thumb src={picture} />
                  ) : (
                    <div className="flex aspect-square h-full items-center justify-center bg-brand-50 text-brand-700">
                      {booking.facility?.iconKey ? (
                        <CategoryIcon
                          iconKey={booking.facility.iconKey}
                          iconSvg={booking.facility.iconSvg}
                          className="text-[2.5rem]"
                        />
                      ) : (
                        <Icon name="location_on" className="text-[2.5rem]" />
                      )}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h1 className="text-xl font-semibold text-gray-900">{booking.venue.name}</h1>
                    <Badge value={booking.status} />
                  </div>
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-gray-500">
                    <Icon
                      name="location_on"
                      className="mt-0.5 shrink-0 text-[0.875rem] text-gray-400"
                    />
                    {booking.venue.address}
                  </p>
                  <a
                    href={directionsLink(booking.venue)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-100 active:scale-95"
                  >
                    <Icon name="navigation" className="text-[0.875rem]" />
                    Directions
                  </a>
                  {booking.venue.contactPhone && (
                    <a
                      href={`tel:${booking.venue.contactPhone}`}
                      className="ml-2 mt-3 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-800 transition hover:bg-gray-50 active:scale-95"
                    >
                      <Icon name="call" className="text-[0.875rem]" />
                      Call venue
                    </a>
                  )}
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">At the venue</h3>
              <div className="flex items-center justify-between gap-4 rounded-xl bg-gray-50 px-4 py-3">
                <div>
                  <p className="text-xs text-gray-500">Show this order number</p>
                  <p className="text-lg font-bold tracking-wide text-gray-900">{booking.orderId}</p>
                </div>
                {countdown && (
                  <p className="text-right text-sm font-semibold text-brand-700">{countdown}</p>
                )}
              </div>
              {booking.venue.contactPhone && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">Venue contact</p>
                    <p className="truncate text-sm font-semibold text-gray-900">{booking.venue.contactPhone}</p>
                  </div>
                  <a
                    href={`tel:${booking.venue.contactPhone}`}
                    className="shrink-0 rounded-xl bg-brand-700 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-800 active:scale-95"
                  >
                    Call
                  </a>
                </div>
              )}
              <ul className="mt-3 space-y-1.5 text-xs text-gray-600">
                <li>Arrive a few minutes early so your slot starts on time.</li>
                {toPayAtVenue > 0 && (
                  <li>Pay the remaining {money(toPayAtVenue.toFixed(2))} at the venue.</li>
                )}
                <li>
                  Your slot ends at{' '}
                  {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}, so
                  the next players can start on time.
                </li>
              </ul>
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Your slot</h3>
              <dl className="space-y-3 text-sm">
                <Row
                  label="Date"
                  value={start.toLocaleDateString(undefined, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                />
                <Row
                  label="Time"
                  value={`${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
                />
                <Row label="Length" value={minutesLabel(minutes)} />
                <Row
                  label="Booked"
                  value={what}
                  sub={booking.facility && booking.resourceName ? booking.facility.name : undefined}
                />
                {booking.groundType && <Row label="Type" value={booking.groundType} />}
              </dl>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Payment</h3>
              <dl className="space-y-3 text-sm">
                <Row label="Total" value={money(amount)} strong />
                {booking.status === 'PENDING_PAYMENT' && advance > 0 && (
                  <Row label="To pay now" value={money(advance)} />
                )}
                {Number(booking.coinsPaid ?? 0) > 0 && <Row label="Paid with Coins" value={money(Number(booking.coinsPaid))} />}
                {Number(booking.moneyPaid ?? 0) > 0 && <Row label="Paid online" value={money(Number(booking.moneyPaid))} />}
                {paid > 0 && Number(booking.coinsPaid ?? 0) + Number(booking.moneyPaid ?? 0) === 0 && <Row label="Paid" value={money(paid)} />}
                {toPayAtVenue > 0 && (
                  <Row label="Pay at the venue" value={money(toPayAtVenue.toFixed(2))} strong />
                )}
                {booking.paymentMethod && Number(booking.coinsPaid ?? 0) + Number(booking.moneyPaid ?? 0) === 0 && <Row label="Method" value={PAYMENT_METHODS[booking.paymentMethod] ?? '—'} />}
              </dl>
              {booking.status === 'PENDING_PAYMENT' && (
                <Link
                  href={`/checkout/${booking.id}`}
                  className="mt-4 block rounded-xl bg-brand-700 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-brand-800 active:scale-95"
                >
                  Pay now
                </Link>
              )}
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">Booking info</h3>
              <dl className="grid gap-3 text-sm">
                <Row label="Order" value={booking.orderId} />
                {booking.createdAt && <Row label="Booked on" value={when(booking.createdAt)} />}
                {booking.status === 'CANCELLED' && booking.cancelledAt && (
                  <Row label="Cancelled on" value={when(booking.cancelledAt)} />
                )}
                {cancelledWhy && <Row label="Why" value={cancelledWhy} />}
                {booking.status === 'CANCELLED' && booking.cancellationNote && (
                  <Row label="Note" value={booking.cancellationNote} />
                )}
              </dl>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4">
                <Link
                  href={`/book/${encodeURIComponent(booking.venue.facilityCode)}/any`}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 active:scale-95"
                >
                  Book this venue again
                </Link>
                <Link
                  href="/support"
                  className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 active:scale-95"
                >
                  Need help?
                </Link>
              </div>
            </Card>

            {cancellable && !cancelResultMessage && (
              <Card>
                {termsShown && preview && <CancellationTerms preview={preview} />}

                {preview && !preview.canCancel && (
                  <p className="text-center text-sm text-gray-600">
                    This booking can no longer be cancelled. If something has gone wrong, contact
                    the venue or{' '}
                    <a href="/support" className="font-medium text-gray-900 underline">
                      our support
                    </a>
                    .
                  </p>
                )}

                {(!preview || preview.canCancel) && (
                  <div className={termsShown ? 'mt-4 border-t border-gray-100 pt-4' : ''}>
                    {!confirmingCancel ? (
                      <Button
                        variant="danger"
                        className="w-full"
                        onClick={() => setConfirmingCancel(true)}
                      >
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
          </div>
        </div>
      </div>
    );
  }
}

/** "Starts in 2 days" / "Starts in 3 h 20 min" / "Happening now" / "Finished", for a confirmed booking. */
function startsIn(start: Date, end: Date): string {
  const now = Date.now();
  if (now >= end.getTime()) return 'Finished';
  if (now >= start.getTime()) return 'Happening now';
  const minutes = Math.round((start.getTime() - now) / 60_000);
  if (minutes < 60) return `Starts in ${minutes} min`;
  if (minutes < 24 * 60) return `Starts in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  const days = Math.round(minutes / (24 * 60));
  return `Starts in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The venue's picture. On a phone it is as wide as the card and shows the whole photo at its own shape. From tablet width up it is a
 * small picture, as tall as the box and as wide as the photo's shape makes it (a very wide or tall photo is held to a sensible shape),
 * so it fills the box with nothing left empty around it.
 */
function Thumb({ src }: { src: string }) {
  const [ratio, setRatio] = useState(1.5);
  return (
    <img
      src={src}
      alt=""
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
        if (w > 0 && h > 0) setRatio(Math.min(2.2, Math.max(0.7, w / h)));
      }}
      style={{ '--ratio': ratio } as React.CSSProperties}
      className="block h-auto max-h-[70vh] w-full object-contain sm:h-full sm:max-h-none sm:w-auto sm:object-cover sm:[aspect-ratio:var(--ratio)]"
    />
  );
}

const CANCEL_REASONS: Record<string, string> = {
  CUSTOMER_REQUESTED: 'You cancelled it',
  HOLD_EXPIRED: "Payment wasn't completed in time",
  RESOURCE_REALLOCATED: 'The venue had to move your slot',
  ADMIN_ACTION: 'Cancelled by the platform',
  OWNER_ACTION: 'Cancelled by the venue',
};

const PAYMENT_METHODS: Record<string, string> = {
  MONEY: 'Paid online',
  COINS: 'Paid with Coins',
  OFFLINE: 'At the venue',
};

/** One label and value of a details card. */
function Row({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right">
        <span className={strong ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}>
          {value}
        </span>
        {sub && <span className="block text-xs text-gray-500">{sub}</span>}
      </dd>
    </div>
  );
}

export default function BookingDetailPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* A slim nav bar like the account page's: just the back button and the account button. */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="flex h-[4.25rem] w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-10 2xl:px-14">
          <div className="-ml-2">
            <BackButton plain />
          </div>
          <AccountMenu />
        </div>
      </header>
      <main className="px-4 pb-8 pt-6 sm:px-6 sm:pb-12 lg:px-10 2xl:px-14">
        <div className="w-full">
          <LoginGate message="Log in to see this booking.">
            <BookingDetail />
          </LoginGate>
        </div>
      </main>
    </div>
  );
}
