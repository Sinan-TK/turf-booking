'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Script from 'next/script';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { formatCountdown, formatDay, formatTimeRange, useCountdown } from '@/lib/checkout';
import { formatPrice } from '@/lib/booking';
import { PaymentSuccess } from '@/components/payment-success';
import type { RazorpayCheckoutOptions } from '@/lib/razorpay';
import { Badge, Button, Card, ErrorBanner, Icon, LoadingState } from '@/components/ui';
import { DetailSkeleton } from '@/components/skeleton';
import { Screen } from '@/components/screen';
import { Modal } from '@/components/modal';
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
  /** How the booking was paid, once it is: exactly one of the two is above zero. */
  coinsPaid?: string;
  moneyPaid?: string;
  venue: { id: string; name: string; address: string };
  resourceName: string | null;
  holdExpiresAt: string;
  /** While PROCESSING: when the wait for the bank's confirmation ends. */
  processingUntil?: string | null;
  /** The server's clock when this was sent (the countdowns follow it, not the visitor's clock). */
  serverNow?: string;
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
  // "Pay ₹X with your Coins?": asked before any Coins are spent.
  const [confirmCoins, setConfirmCoins] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  // True from the moment the payment popup opens until it is closed or answers, so "slot no longer held" never shows behind it.
  const [popupOpen, setPopupOpen] = useState(false);
  // How far the visitor's clock is from the server's (server minus visitor), so the countdowns agree with the server.
  const [skewMs, setSkewMs] = useState(0);
  const [celebrate, setCelebrate] = useState(false);
  const sawUnpaid = useRef(false);
  const router = useRouter();
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
      if (b.serverNow) setSkewMs(Date.parse(b.serverNow) - Date.now());
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
  const processing = mine !== null && mine.status === 'PROCESSING';

  // A booking that turns CONFIRMED while this page was waiting for money gets the success moment, then moves on to the booking;
  // one that was already confirmed when opened goes straight to its page.
  useEffect(() => {
    if (!mine) return;
    if (mine.status === 'PENDING_PAYMENT' || mine.status === 'PROCESSING') sawUnpaid.current = true;
    if (mine.status === 'CONFIRMED') {
      if (sawUnpaid.current) setCelebrate(true);
      else router.replace(`/bookings/${mine.id}`);
    }
  }, [mine, router]);

  // While the bank's confirmation is awaited, ask the server (which asks the gateway) every few seconds, so this never depends on the webhook.
  useEffect(() => {
    if (!processing || !mine) return;
    const id = mine.id;
    const timer = setInterval(() => {
      api
        .get(`/payments/sync/${id}`)
        .catch(() => undefined)
        .finally(() => void load());
    }, 3000);
    return () => clearInterval(timer);
  }, [processing, mine, load]);

  useEffect(() => {
    if (!pending) return;
    api
      .get<CoinWallet>('/me/coins')
      .then((w) => mounted.current && setWallet(w))
      .catch(() => undefined); // non-critical — paying with Coins just won't be offered
  }, [pending]);

  // When the hold runs out, refetch so the page flips without a reload.
  const clientTime = (iso: string) => new Date(Date.parse(iso) - skewMs).toISOString();
  const secondsLeft = useCountdown(mine && pending ? clientTime(mine.holdExpiresAt) : null, () => {
    load();
  });
  const processingLeft = useCountdown(mine && processing && mine.processingUntil ? clientTime(mine.processingUntil) : null, () => {
    load();
  });
  // A payment already in flight must survive the timer running out.
  const holdActive = pending && secondsLeft !== null && secondsLeft > 0;
  const holdLost = mine !== null && !confirmingPayment && !popupOpen && (mine.status === 'CANCELLED' || (pending && secondsLeft === 0));

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
      if (err instanceof ApiError && err.status === 409) void load();
    }
  }

  // After Razorpay's own success callback the browser tells the server (which checks the signature and asks the gateway itself), so the
  // booking is confirmed without waiting for the webhook; if the bank has not confirmed yet the booking is PROCESSING and the loop above settles it.
  async function afterPaid(response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }, id: string) {
    setPopupOpen(false);
    setConfirmingPayment(true);
    try {
      await api.post('/payments/verify', {
        bookingId: id,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
    } catch {
      // The page below shows the truth either way; the server also finds the payment by itself.
    }
    await load();
    if (mounted.current) setConfirmingPayment(false);
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
      const order = await api.post<{ gatewayOrderId: string; amount: string; currency: string; processingUntil?: string }>(
        '/payments/create-order',
        { bookingId: booking.id },
      );

      const options: RazorpayCheckoutOptions = {
        key: razorpayKey,
        amount: Math.round(Number(order.amount) * 100),
        currency: order.currency,
        name: 'Bookyo',
        description: `Booking ${booking.orderId}`,
        order_id: order.gatewayOrderId,
        // The popup closes by itself when the booking's 5-minute processing window ends.
        timeout: order.processingUntil ? Math.max(60, Math.floor((Date.parse(order.processingUntil) - Date.now()) / 1000)) : undefined,
        handler: (response) => void afterPaid(response, booking.id),
        modal: {
          // Closed without paying: the booking goes back from PROCESSING to pending, the slot stays held, and they can try again.
          ondismiss: () => {
            setPopupOpen(false);
            void api
              .post('/payments/cancel-attempt', { bookingId: booking.id })
              .catch(() => undefined)
              .finally(() => void load());
          },
        },
        theme: { color: '#050505' },
      };
      const checkout = new window.Razorpay(options);
      checkout.on('payment.failed', (res) => {
        setPayError(res.error?.description ?? 'The payment did not go through. You can try again.');
      });
      setPopupOpen(true);
      checkout.open();
      // The booking is PROCESSING from here on: show it.
      void load();
    } catch (err) {
      setPopupOpen(false);
      setPayError(err instanceof ApiError ? err.message : 'Could not start payment.');
      if (err instanceof ApiError && err.status === 409) void load();
    }
  }

  // Only the booking amount (the advance) is paid now; the rest of the full price is paid at the venue.
  const dueNow = booking ? (Number(booking.advanceAmount) > 0 ? Number(booking.advanceAmount) : Number(booking.amount)) : 0;
  const insufficientCoins = !wallet || (booking ? Number(wallet.cachedBalance) < dueNow : true);
  // How many more Coins it takes, so the customer can top the wallet up for exactly that.
  const missingCoins = wallet ? Math.max(0, Math.ceil((dueNow - Number(wallet.cachedBalance)) * 100) / 100) : 0;

  const paidWithCoins = mine !== null && Number(mine.coinsPaid ?? 0) > 0;
  const paidAmount = mine
    ? formatPrice({ amount: String(paidWithCoins ? mine.coinsPaid : Number(mine.moneyPaid ?? 0) > 0 ? mine.moneyPaid : dueNow), currency: mine.currency })
    : '';

  return (
    <Screen>
      {celebrate && mine && (
        <PaymentSuccess
          amount={paidAmount}
          detail={paidWithCoins ? 'Paid with Coins' : 'Paid online'}
          onDone={() => router.replace(`/bookings/${mine.id}`)}
        />
      )}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-semibold text-gray-900">
        <Icon name="schedule" />
        Checkout
      </h1>

      {(view === 'loading' || customerLoading) && <DetailSkeleton rows={7} />}

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
              <Link href="/explore" className="block">
                <Button className="w-full">Choose another time</Button>
              </Link>
            </div>
          )}

          {!holdLost && confirmingPayment && !processing && <LoadingState message="Confirming your payment…" />}

          {processing && (
            <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-5 text-center" role="status">
              <p className="text-sm font-semibold text-gray-900">{popupOpen ? 'Complete your payment…' : 'Confirming your payment…'}</p>
              <p className="text-sm text-gray-600">
                {popupOpen
                  ? 'Finish the payment in the payment window. Your slot is kept for you'
                  : 'We are waiting for the bank to confirm your payment. Your slot is kept for you'}
                {processingLeft !== null && processingLeft > 0 ? ` (${formatCountdown(processingLeft)} left)` : ''}.
              </p>
              <p className="text-xs text-gray-500">You can leave this page: your booking appears under Bookings as soon as it is confirmed.</p>
            </div>
          )}

          {mine.status === 'FAILED' && (
            <div className="space-y-3">
              <ErrorBanner message="We could not confirm your payment, so the slot was released. If money was deducted it returns to your bank automatically, usually within a few days. If it does not, contact support with your order number." />
              <Link href="/explore" className="block">
                <Button className="w-full">Choose another time</Button>
              </Link>
              <Link href="/support" className="block text-center text-sm font-medium text-gray-700 underline">
                Contact support
              </Link>
            </div>
          )}

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
                  <Icon name="bolt" className="text-[1.25rem]" />
                  {paying ? 'Please wait…' : 'Pay online'}
                </Button>
                <Button
                  variant="secondary"
                  className="flex w-full items-center justify-center gap-1.5"
                  disabled={!holdActive || paying || confirmingPayment || insufficientCoins}
                  onClick={() => setConfirmCoins(true)}
                >
                  <Icon name="coin" className="text-[1.25rem]" />
                  Pay with Coins {wallet ? `(balance: ${formatPrice({ amount: wallet.cachedBalance, currency: wallet.currency })})` : ''}
                </Button>
                {confirmCoins && wallet && (
                  <Modal title="Pay with Coins?" onClose={() => setConfirmCoins(false)}>
                    <div className="space-y-4 px-5 py-5">
                      <p className="text-sm text-gray-700">
                        <strong className="text-gray-900">{formatPrice({ amount: String(dueNow), currency: wallet.currency })}</strong> will be taken from
                        your Coins to confirm this booking.
                      </p>
                      <dl className="space-y-1.5 rounded-xl bg-gray-50 px-4 py-3 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Coins now</dt>
                          <dd className="font-medium text-gray-900">{formatPrice({ amount: wallet.cachedBalance, currency: wallet.currency })}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Coins after</dt>
                          <dd className="font-medium text-gray-900">
                            {formatPrice({ amount: String(Math.max(0, Number(wallet.cachedBalance) - dueNow)), currency: wallet.currency })}
                          </dd>
                        </div>
                      </dl>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setConfirmCoins(false)}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          onClick={() => {
                            setConfirmCoins(false);
                            void guarded(onPayWithCoins);
                          }}
                        >
                          Pay {formatPrice({ amount: String(dueNow), currency: wallet.currency })} with Coins
                        </Button>
                      </div>
                    </div>
                  </Modal>
                )}
                {wallet && insufficientCoins && (
                  <p className="text-center text-xs text-gray-500">
                    You need {formatPrice({ amount: String(missingCoins), currency: wallet.currency })} more Coins.{' '}
                    <Link
                      href={`/account?tab=wallet&add=${Math.ceil(missingCoins)}&back=${encodeURIComponent(`/checkout/${mine.id}`)}`}
                      className="font-semibold text-gray-900 underline underline-offset-2"
                    >
                      Add money to your wallet
                    </Link>
                  </p>
                )}
              </div>
              <p className="mt-4 text-center text-xs text-gray-400">
                Pay with money or with Coins, one or the other for each booking.
              </p>
              <p className="mt-2 text-center text-xs text-gray-400">
                By paying you agree to the{' '}
                <Link href="/terms" className="underline underline-offset-2 hover:text-gray-600">
                  Terms of Use
                </Link>{' '}
                and the{' '}
                <Link href="/refunds" className="underline underline-offset-2 hover:text-gray-600">
                  Cancellation &amp; Refund Policy
                </Link>
                .
              </p>
            </>
          )}

          {mine.status === 'CANCELLED' && !holdLost && (
            <Link href="/explore" className="block">
              <Button className="w-full">Choose another time</Button>
            </Link>
          )}

          {mine.status === 'CONFIRMED' && !celebrate && (
            <Link href={`/bookings/${mine.id}`} className="block">
              <Button className="w-full">View booking</Button>
            </Link>
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
