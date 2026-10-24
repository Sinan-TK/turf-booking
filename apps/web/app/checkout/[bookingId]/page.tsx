'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Script from 'next/script';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { formatCountdown, formatDay, formatTimeRange, useCountdown } from '@/lib/checkout';
import type { RazorpayCheckoutOptions } from '@/lib/razorpay';
import { Badge, Button, Card, ErrorBanner, Icon, LoadingState, SuccessBanner } from '@/components/ui';
import { Screen } from '@/components/screen';
import { CancellationTerms, useCancellationPreview } from '@/components/cancellation-terms';

interface CheckoutBooking {
  id: string;
  orderId: string;
  customerId: string;
  status: string;
  /** The full price. */
  amount: string;
  /** The part charged now, online or with Coins, to hold the slot. */
  advanceAmount?: string;
  currency: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  groundType: string;
  paymentMethod: string | null;
  venue: { id: string; name: string; address: string };
  resourceName: string | null;
  holdExpiresAt: string;
}
interface CoinWallet {
  cachedBalance: string;
  currency: string;
}

type View = 'loading' | 'login' | 'notfound' | 'error' | 'ready';

export default function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const { customer, loading: customerLoading, requireLogin } = useCustomer();

  const [view, setView] = useState<View>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [booking, setBooking] = useState<CheckoutBooking | null>(null);
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const payingRef = useRef(false);
  const mounted = useRef(true);
  const preview = useCancellationPreview(bookingId, booking?.status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const customerId = customer?.id ?? null;

  const load = useCallback(async () => {
    try {
      const b = await api.get<CheckoutBooking>(`/me/bookings/${bookingId}`);
      if (!mounted.current) return;
      setBooking(b);
      setView('ready');
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setView('login');
      } else if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        setBooking(null);
        setView('notfound');
      } else {
        setLoadError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setView('error');
      }
    }
  }, [bookingId]);

  // (Re)load whenever the logged-in customer changes, and never keep one
  // customer's booking on screen after another logs in.
  useEffect(() => {
    if (customerLoading) return;
    setBooking(null);
    setWallet(null);
    setPayError(null);
    if (!customerId) {
      setView('login');
      requireLogin().catch(() => undefined); // dismissed → the login prompt below stays
      return;
    }
    setView('loading');
    load();
  }, [customerLoading, customerId, load, requireLogin]);

  // Only ever render a booking that belongs to the logged-in customer (the
  // API already scopes it; this covers stale state after switching accounts).
  const mine = booking !== null && customerId !== null && booking.customerId === customerId ? booking : null;
  const pending = mine !== null && mine.status === 'PENDING_PAYMENT';

  useEffect(() => {
    if (!pending) return;
    api
      .get<CoinWallet>('/me/coins')
      .then((w) => mounted.current && setWallet(w))
      .catch(() => undefined); // non-critical — paying with Coins just won't be offered
  }, [pending]);

  // When the hold runs out, refetch so the page flips without a reload.
  const secondsLeft = useCountdown(mine && pending ? mine.holdExpiresAt : null, () => {
    load();
  });
  // A payment already in flight must survive the timer running out.
  const holdActive = pending && secondsLeft !== null && secondsLeft > 0;
  const holdLost = mine !== null && !confirmingPayment && (mine.status === 'CANCELLED' || (pending && secondsLeft === 0));

  async function guarded(fn: () => Promise<void>) {
    if (payingRef.current) return;
    payingRef.current = true;
    setPaying(true);
    try {
      await fn();
    } finally {
      payingRef.current = false;
      if (mounted.current) setPaying(false);
    }
  }

  async function onPayWithCoins() {
    if (!booking) return;
    setPayError(null);
    try {
      await api.post(`/bookings/${booking.id}/pay-with-coins`, {});
      await load();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Payment with Coins failed.');
    }
  }

  // The webhook, not this browser callback, is what actually confirms the
  // booking (ARCHITECTURE.md §9) — after Razorpay's own success handler
  // fires, this polls the booking's own status for a short window instead
  // of trusting the redirect.
  async function pollForConfirmation(id: string) {
    setConfirmingPayment(true);
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!mounted.current) return;
      try {
        const current = await api.get<CheckoutBooking>(`/me/bookings/${id}`);
        if (current.status === 'CONFIRMED') {
          setBooking(current);
          setConfirmingPayment(false);
          return;
        }
        if (current.status === 'CANCELLED') {
          setBooking(current);
          setConfirmingPayment(false);
          setPayError(
            'This booking was cancelled before payment could be confirmed — the slot may have expired. Any captured payment is refunded to Coins.',
          );
          return;
        }
      } catch {
        // keep polling
      }
    }
    setConfirmingPayment(false);
    setPayError("Payment is still being confirmed. This can take a minute — check 'Bookings' shortly.");
  }

  async function onPayWithRazorpay() {
    if (!booking) return;
    const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!razorpayKey || !window.Razorpay) {
      setPayError('Online payment is not available right now — please try again shortly.');
      return;
    }
    setPayError(null);
    try {
      const order = await api.post<{ gatewayOrderId: string; amount: string; currency: string }>(
        '/payments/create-order',
        { bookingId: booking.id },
      );

      const options: RazorpayCheckoutOptions = {
        key: razorpayKey,
        amount: Math.round(Number(order.amount) * 100),
        currency: order.currency,
        name: 'Venue Booking',
        description: `Booking ${booking.orderId}`,
        order_id: order.gatewayOrderId,
        handler: (response) => {
          api
            .post('/payments/verify', {
              bookingId: booking.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            })
            .catch(() => undefined) // fast-path only; the webhook is authoritative either way
            .finally(() => pollForConfirmation(booking.id));
        },
        theme: { color: '#047857' },
      };
      new window.Razorpay(options).open();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not start payment.');
    }
  }

  // Only the booking amount (the advance) is paid now; the rest of the full price is paid at the venue.
  const dueNow = booking ? (Number(booking.advanceAmount) > 0 ? Number(booking.advanceAmount) : Number(booking.amount)) : 0;
  const insufficientCoins = !wallet || (booking ? Number(wallet.cachedBalance) < dueNow : true);

  return (
    <Screen>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="schedule" />
        Checkout
      </h1>

      {(view === 'loading' || customerLoading) && <LoadingState message="Loading your booking…" />}

      {!customerLoading && view === 'login' && (
        <Card>
          <p className="mb-4 text-center text-sm text-gray-600">Log in to see and pay for your booking.</p>
          <Button className="w-full" onClick={() => requireLogin().catch(() => undefined)}>
            Log in
          </Button>
        </Card>
      )}

      {view === 'error' && <ErrorBanner message={loadError ?? 'Something went wrong.'} />}

      {view === 'ready' && !mine && <NotFound />}
      {view === 'notfound' && <NotFound />}

      {view === 'ready' && mine && (
        <Card>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-500">Order {mine.orderId}</p>
              <h2 className="mt-0.5 truncate text-lg font-semibold text-gray-900">{mine.venue.name}</h2>
              <p className="text-xs text-gray-500">{mine.venue.address}</p>
            </div>
            <Badge value={mine.status} />
          </div>

          <dl className="mb-5 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">When</dt>
              <dd className="text-right font-medium">
                {formatDay(mine.startTime)} · {formatTimeRange(mine.startTime, mine.durationMinutes)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Where</dt>
              <dd className="text-right font-medium">
                {mine.resourceName ? `${mine.resourceName} · ` : ''}
                {mine.groundType}
              </dd>
            </div>
            {Number(mine.advanceAmount) > 0 && Number(mine.advanceAmount) < Number(mine.amount) ? (
              <div className="space-y-2 border-t border-gray-100 pt-2">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Total</dt>
                  <dd className="font-medium text-gray-900">
                    {mine.currency} {mine.amount}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Pay now to hold the slot</dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    {mine.currency} {mine.advanceAmount}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Pay at the venue</dt>
                  <dd className="font-medium text-gray-900">
                    {mine.currency} {(Number(mine.amount) - Number(mine.advanceAmount)).toFixed(2)}
                  </dd>
                </div>
              </div>
            ) : (
              <div className="flex justify-between gap-3 border-t border-gray-100 pt-2">
                <dt className="text-gray-500">Amount</dt>
                <dd className="text-lg font-semibold text-gray-900">
                  {mine.currency} {mine.amount}
                </dd>
              </div>
            )}
          </dl>

          {preview && preview.windows.length > 0 && (
            <div className="mb-5 -mt-2">
              <CancellationTerms preview={preview} />
            </div>
          )}

          {payError && (
            <div role="alert" className="mb-4">
              <ErrorBanner message={payError} />
            </div>
          )}

          {holdLost && (
            <div className="space-y-3">
              <ErrorBanner message="This slot is no longer held. Slots are kept for a few minutes while you pay." />
              <Link href="/" className="block">
                <Button className="w-full">Choose another time</Button>
              </Link>
            </div>
          )}

          {!holdLost && confirmingPayment && <LoadingState message="Confirming your payment…" />}

          {!holdLost && pending && (
            <>
              {secondsLeft !== null && (
                <p
                  className={`mb-4 text-center text-sm font-medium ${secondsLeft <= 60 ? 'text-red-700' : 'text-gray-700'}`}
                  aria-live="off"
                >
                  Slot held for {formatCountdown(secondsLeft)}
                </p>
              )}
              <div className="space-y-3">
                <Button
                  className="flex w-full items-center justify-center gap-1.5"
                  disabled={!holdActive || paying || confirmingPayment}
                  onClick={() => guarded(onPayWithRazorpay)}
                >
                  <Icon name="bolt" className="text-[20px]" />
                  {paying ? 'Please wait…' : 'Pay online'}
                </Button>
                <Button
                  variant="secondary"
                  className="flex w-full items-center justify-center gap-1.5"
                  disabled={!holdActive || paying || confirmingPayment || insufficientCoins}
                  onClick={() => guarded(onPayWithCoins)}
                >
                  Pay with Coins {wallet ? `(balance: ${wallet.cachedBalance})` : ''}
                </Button>
              </div>
              <p className="mt-4 text-center text-xs text-gray-400">
                Pay with money or Coins — never both for the same booking.
              </p>
            </>
          )}

          {mine.status !== 'PENDING_PAYMENT' && mine.status !== 'CANCELLED' && (
            <div className="space-y-3">
              {mine.status === 'CONFIRMED' && (
                <SuccessBanner
                  message={
                    <span className="flex items-center gap-1.5">
                      <Icon name="bolt" className="text-[18px]" />
                      Booking confirmed! We have sent the details to your WhatsApp.
                    </span>
                  }
                />
              )}
              <Link href={`/bookings/${mine.id}`} className="block">
                <Button className="w-full">View booking</Button>
              </Link>
              <Link href="/" className="block">
                <Button variant="secondary" className="w-full">
                  Back to home
                </Button>
              </Link>
            </div>
          )}
        </Card>
      )}
    </Screen>
  );
}

function NotFound() {
  return (
    <Card>
      <p className="mb-4 text-center text-sm text-gray-600">We couldn&apos;t find that booking.</p>
      <Link href="/" className="block">
        <Button className="w-full">Back to home</Button>
      </Link>
    </Card>
  );
}
