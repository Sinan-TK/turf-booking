'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Script from 'next/script';
import { api, ApiError } from '@/lib/api';
import type { RazorpayCheckoutOptions } from '@/lib/razorpay';
import { durationLabel, type VenueCategory } from '@/lib/categories';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Icon,
  Input,
  Label,
  LoadingState,
  Screen,
  Select,
  SuccessBanner,
} from '@/components/ui';

interface District {
  id: string;
  name: string;
}
interface SearchResult {
  venue: { id: string; name: string; facilityCode: string; address: string };
  resource: { id: string; name: string; groundType: string };
  distanceKm?: number;
  availableStartTimes: string[];
  price: { amount: string; currency: string } | null;
}
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
interface CoinWallet {
  cachedBalance: string;
  currency: string;
}

const TIME_WINDOWS = [
  { value: 'MORNING', label: 'Morning (6 AM – 12 PM)' },
  { value: 'AFTERNOON', label: 'Afternoon (12 PM – 6 PM)' },
  { value: 'EVENING', label: 'Evening (6 PM – 12 AM)' },
  { value: 'LATE_NIGHT', label: 'Late Night (12 AM – 6 AM)' },
];
// Used until a venue type is chosen ("All"): the platform-default lengths.
const DEFAULT_DURATIONS = [60, 120, 180];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "6:00 AM – 7:00 AM" — the end time customers actually need to know
 * before booking, not just when the slot starts. */
function formatTimeRange(startIso: string, durationMinutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)} – ${fmt(end)}`;
}

type Step =
  | 'loading'
  | 'expired'
  | 'search'
  | 'results'
  | 'payment'
  | 'confirmed'
  | 'error'
  | 'session-timeout';

/**
 * mm:ss countdown to `expiresAtIso`, ticking every second, calling
 * `onExpire` once when it reaches zero (guarded so it can't fire twice
 * across renders).
 */
function useCountdown(expiresAtIso: string | null, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const expiredRef = useState(() => ({ fired: false }))[0];

  useEffect(() => {
    if (!expiresAtIso) return;
    const target = new Date(expiresAtIso).getTime();

    const tick = () => {
      const remaining = Math.max(0, Math.round((target - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !expiredRef.fired) {
        expiredRef.fired = true;
        onExpire();
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // Deliberately keyed only on expiresAtIso — onExpire is passed fresh
    // each render but calling it isn't meant to restart the interval.
  }, [expiresAtIso]);

  return secondsLeft;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function BookPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by a "saved venue" shortcut link (WhatsApp's "Book a Venue" menu,
  // or this same page's own Save button on a past search) — when
  // present, search locks to that one venue instead of asking for a
  // district. /search already supports facilityCode as an alternative
  // to districtId (apps/api/src/availability/dto/search.dto.ts), so no
  // backend change was needed for this.
  const facilityCode = searchParams.get('facilityCode');
  // Set by the WhatsApp bot's "Book This Slot" confirmation
  // (whatsapp-menu.service.ts's handleBookSlotConfirm) — the slot has
  // already been held server-side via the same BookingsService.createHold
  // every other path uses, so this link skips search/hold entirely and
  // goes straight to the payment step for that existing booking.
  const bookingId = searchParams.get('bookingId');

  const [step, setStep] = useState<Step>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const [districts, setDistricts] = useState<District[]>([]);
  // Venue types come from the API (Super-Admin managed), not a hardcoded list.
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  useEffect(() => {
    api
      .get<VenueCategory[]>('/categories')
      .then(setCategories)
      .catch(() => undefined);
  }, []);
  const [form, setForm] = useState({
    districtId: '',
    categorySlug: '',
    date: todayIso(),
    timeWindow: 'MORNING',
    durationMinutes: 60,
  });
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  // Which venues (by id) the customer has already saved — fetched once
  // the CustomerSession cookie exists, so the ❤️ toggle on each result
  // renders correctly without a per-card round trip.
  const [savedVenueIds, setSavedVenueIds] = useState<Set<string>>(new Set());
  const [savingVenueId, setSavingVenueId] = useState<string | null>(null);

  const [holding, setHolding] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [payingWithCoins, setPayingWithCoins] = useState(false);
  const [payingWithMoney, setPayingWithMoney] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);

  // The BookingSession is the 20-minute browsing journey, not the slot
  // reservation itself — once a slot is actually held (step moves past
  // 'results'), the SlotHold's own separate expiry governs things, and a
  // payment already in flight must survive even if this timer would
  // otherwise have run out (ARCHITECTURE.md). So the countdown only
  // ticks, and can only end the session, while still browsing.
  const browsing = step === 'search' || step === 'results';
  const secondsLeft = useCountdown(browsing ? sessionExpiresAt : null, () => {
    setStep('session-timeout');
  });

  // Resolving the link both validates it AND authenticates the browser
  // (GET /booking-sessions/:token sets the CustomerSession cookie) — this
  // must happen before any other customer API call.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await api.get<{ expiresAt: string }>(`/booking-sessions/${token}`);
        setSessionExpiresAt(session.expiresAt);

        if (bookingId) {
          // Already held by the WhatsApp bot — jump straight to payment
          // instead of loading districts/showing the search form.
          const existing = await api.get<Booking>(`/me/bookings/${bookingId}`);
          if (cancelled) return;
          setBooking(existing);
          try {
            setWallet(await api.get<CoinWallet>('/me/coins'));
          } catch {
            // Non-critical — paying with coins just won't be offered.
          }
          setStep('payment');
        } else {
          const list = await api.get<District[]>('/districts');
          if (cancelled) return;
          setDistricts(list);
          setStep('search');
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setStep('expired');
        } else {
          setErrorMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
          setStep('error');
        }
        return;
      }
      // Best-effort — a customer who's never saved anything, or whose
      // saved-venues lookup fails for any reason, still sees a fully
      // working search; the ❤️ toggle just starts unfilled.
      try {
        const saved = await api.get<Array<{ id: string }>>('/me/saved-venues');
        if (!cancelled) setSavedVenueIds(new Set(saved.map((t) => t.id)));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
    // bookingId is read once on mount, same as token/facilityCode — not
    // meant to re-run this effect if the URL were mutated client-side.
  }, [token]);

  const runSearch = useCallback(async () => {
    setSearching(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        date: form.date,
        timeWindow: form.timeWindow,
        durationMinutes: String(form.durationMinutes),
      });
      if (form.categorySlug) params.set('categorySlug', form.categorySlug);
      // facilityCode is an alternative to districtId, not additive —
      // sending both isn't wrong, but omitting the (irrelevant, hidden)
      // district when locked to a specific saved venue keeps the request
      // honest about what's actually driving the search.
      if (facilityCode) {
        params.set('facilityCode', facilityCode);
      } else {
        params.set('districtId', form.districtId);
      }
      const data = await api.get<SearchResult[]>(`/search?${params.toString()}`);
      setResults(data);
      setSearched(true);
      setStep('results');
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }, [facilityCode, form.categorySlug, form.date, form.timeWindow, form.durationMinutes, form.districtId]);

  // A saved-venue shortcut link jumps straight to results with today's
  // date and the default time window/duration — one less step than
  // making the customer re-submit the form for a venue they already
  // picked. They can still adjust date/time and re-search from there.
  useEffect(() => {
    if (facilityCode && step === 'search' && !searched) {
      runSearch();
    }
  }, [facilityCode, step]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    await runSearch();
  }

  async function onToggleSaved(venueId: string) {
    setSavingVenueId(venueId);
    const alreadySaved = savedVenueIds.has(venueId);
    try {
      if (alreadySaved) {
        await api.delete(`/me/saved-venues/${venueId}`);
        setSavedVenueIds((prev) => {
          const next = new Set(prev);
          next.delete(venueId);
          return next;
        });
      } else {
        await api.post('/me/saved-venues', { venueId });
        setSavedVenueIds((prev) => new Set(prev).add(venueId));
      }
    } catch {
      // Non-critical — saving a venue failing shouldn't interrupt
      // booking. The toggle just doesn't visually flip, so the customer
      // can retry.
    } finally {
      setSavingVenueId(null);
    }
  }

  async function onPickSlot(resourceId: string, startTime: string) {
    setHolding(`${resourceId}|${startTime}`);
    setErrorMessage(null);
    try {
      const hold = await api.post<Booking>('/bookings/hold', {
        resourceId,
        startTime,
        durationMinutes: form.durationMinutes,
      });
      setBooking(hold);
      const w = await api.get<CoinWallet>('/me/coins');
      setWallet(w);
      setStep('payment');
    } catch (err) {
      setErrorMessage(
        err instanceof ApiError
          ? err.message
          : 'Could not hold that slot — it may have just been taken.',
      );
    } finally {
      setHolding(null);
    }
  }

  async function onPayWithCoins() {
    if (!booking) return;
    setPayingWithCoins(true);
    setErrorMessage(null);
    try {
      const updated = await api.post<Booking>(`/bookings/${booking.id}/pay-with-coins`, {});
      setBooking(updated);
      setStep('confirmed');
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Payment with coins failed.');
    } finally {
      setPayingWithCoins(false);
    }
  }

  // The webhook, not this browser callback, is what actually confirms
  // the booking (ARCHITECTURE.md §9) — after Razorpay's own success
  // handler fires, this just polls the booking's own status for a short
  // window rather than trusting the redirect.
  async function pollForConfirmation(bookingId: string) {
    setConfirmingPayment(true);
    for (let i = 0; i < 14; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const current = await api.get<Booking>(`/me/bookings/${bookingId}`);
        if (current.status === 'CONFIRMED') {
          setBooking(current);
          setStep('confirmed');
          setConfirmingPayment(false);
          return;
        }
        if (current.status === 'CANCELLED') {
          setErrorMessage(
            'This booking was cancelled before payment could be confirmed — the slot may have expired. Any captured payment is refunded to Coins.',
          );
          setConfirmingPayment(false);
          return;
        }
      } catch {
        // keep polling
      }
    }
    setConfirmingPayment(false);
    setErrorMessage(
      "Payment is still being confirmed. This can take a minute — check 'My Bookings' shortly.",
    );
  }

  async function onPayWithRazorpay() {
    if (!booking) return;
    const razorpayKey = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!razorpayKey || !window.Razorpay) {
      setErrorMessage('Online payment is not available right now — please try again shortly.');
      return;
    }
    setPayingWithMoney(true);
    setErrorMessage(null);
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
        modal: {
          ondismiss: () => setPayingWithMoney(false),
        },
        theme: { color: '#047857' },
      };
      new window.Razorpay(options).open();
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not start payment.');
    } finally {
      setPayingWithMoney(false);
    }
  }

  return (
    <Screen>
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="mb-6 flex items-center justify-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
          <Icon name="sports_soccer" />
          Book a Venue
        </h1>
        {browsing && secondsLeft !== null && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              secondsLeft <= 60 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
            }`}
            title="Time left to finish browsing and pick a slot"
          >
            ⏱ {formatCountdown(secondsLeft)}
          </span>
        )}
      </div>

      {step === 'loading' && <LoadingState message="Loading your booking link…" />}

      {step === 'expired' && (
        <Card>
          <ErrorBanner message="This booking link has expired. Send 'Hi' on WhatsApp and tap 'Book a Venue' again for a fresh link." />
        </Card>
      )}

      {step === 'session-timeout' && (
        <Card>
          <ErrorBanner message="Your browsing session timed out. Send 'Hi' on WhatsApp and tap 'Book a Venue' again for a fresh link." />
        </Card>
      )}

      {step === 'error' && (
        <Card>
          <ErrorBanner message={errorMessage ?? 'Something went wrong.'} />
        </Card>
      )}

      {(step === 'search' || step === 'results') && (
        <div className="space-y-6">
          <Card>
            <form onSubmit={onSearch} className="space-y-4">
              {errorMessage && <ErrorBanner message={errorMessage} />}
              {facilityCode ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  ⭐ Showing availability for your saved venue ({facilityCode}).
                </div>
              ) : (
                <div>
                  <Label>District</Label>
                  <Select
                    required
                    value={form.districtId}
                    onChange={(e) => setForm((f) => ({ ...f, districtId: e.target.value }))}
                  >
                    <option value="">Select district…</option>
                    {districts.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Venue type</Label>
                  <Select
                    value={form.categorySlug}
                    onChange={(e) => {
                      const category = categories.find((c) => c.slug === e.target.value);
                      setForm((f) => ({
                        ...f,
                        categorySlug: e.target.value,
                        durationMinutes: category ? category.policy.minDurationMin : 60,
                      }));
                    }}
                  >
                    <option value="">All</option>
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Duration</Label>
                  <Select
                    value={form.durationMinutes}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))
                    }
                  >
                    {(categories.find((c) => c.slug === form.categorySlug)?.policy.durations ?? DEFAULT_DURATIONS).map(
                      (d) => (
                        <option key={d} value={d}>
                          {durationLabel(d)}
                        </option>
                      ),
                    )}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Date</Label>
                  <Input
                    required
                    type="date"
                    min={todayIso()}
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>Time</Label>
                  <Select
                    value={form.timeWindow}
                    onChange={(e) => setForm((f) => ({ ...f, timeWindow: e.target.value }))}
                  >
                    {TIME_WINDOWS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <Button type="submit" disabled={searching} className="flex w-full items-center justify-center gap-1.5">
                {searching ? 'Searching…' : (
                  <>
                    <Icon name="search" className="text-[20px]" />
                    Find Venues
                  </>
                )}
              </Button>
            </form>
          </Card>

          {step === 'results' && (
            <div className="space-y-4">
              {results.length === 0 && searched && (
                <Card>
                  <p className="text-center text-sm text-gray-500">
                    No venues available for that search. Try a different time or date.
                  </p>
                </Card>
              )}
              {results.map((r) => (
                <Card key={`${r.venue.id}-${r.resource.id}`}>
                  <div className="mb-1 flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{r.venue.name}</p>
                      <p className="text-xs text-gray-500">
                        {r.venue.facilityCode} · {r.venue.address}
                        {r.distanceKm !== undefined ? ` · ${r.distanceKm} km away` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
                      {r.price && (
                        <p className="whitespace-nowrap text-sm font-semibold text-emerald-700">
                          {r.price.currency} {r.price.amount}
                        </p>
                      )}
                      <button
                        type="button"
                        aria-label={savedVenueIds.has(r.venue.id) ? 'Unsave this venue' : 'Save this venue'}
                        disabled={savingVenueId === r.venue.id}
                        onClick={() => onToggleSaved(r.venue.id)}
                        className="leading-none text-rose-500 disabled:opacity-50"
                      >
                        <Icon name="favorite" filled={savedVenueIds.has(r.venue.id)} />
                      </button>
                    </div>
                  </div>
                  <p className="mb-3 text-xs text-gray-600">
                    {r.resource.name} ({r.resource.groundType})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {r.availableStartTimes.map((t) => {
                      const key = `${r.resource.id}|${t}`;
                      return (
                        <Button
                          key={key}
                          variant="secondary"
                          disabled={holding === key}
                          onClick={() => onPickSlot(r.resource.id, t)}
                        >
                          {holding === key ? 'Holding…' : formatTimeRange(t, form.durationMinutes)}
                        </Button>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'payment' && booking && (
        <Card>
          <p className="mb-1 text-xs uppercase tracking-wide text-gray-500">Order {booking.orderId}</p>
          <p className="mb-4 text-sm text-gray-700">
            {new Date(booking.startTime).toLocaleString()} · {booking.groundType}
          </p>
          <p className="mb-6 text-2xl font-semibold text-gray-900">
            {booking.currency} {booking.amount}
          </p>

          {errorMessage && (
            <div className="mb-4">
              <ErrorBanner message={errorMessage} />
            </div>
          )}
          {confirmingPayment && (
            <div className="mb-4">
              <LoadingState message="Confirming your payment…" />
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="flex w-full items-center justify-center gap-1.5"
              disabled={payingWithMoney || confirmingPayment}
              onClick={onPayWithRazorpay}
            >
              {payingWithMoney ? 'Opening payment…' : (
                <>
                  <Icon name="credit_card" className="text-[20px]" />
                  Pay with Razorpay
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              className="flex w-full items-center justify-center gap-1.5"
              disabled={
                payingWithCoins ||
                confirmingPayment ||
                !wallet ||
                Number(wallet.cachedBalance) < Number(booking.amount)
              }
              onClick={onPayWithCoins}
            >
              {payingWithCoins ? 'Paying…' : (
                <>
                  <Icon name="toll" className="text-[20px]" />
                  Pay with Coins {wallet ? `(balance: ${wallet.cachedBalance})` : ''}
                </>
              )}
            </Button>
          </div>
          <p className="mt-4 text-center text-xs text-gray-400">
            Pay with money or coins — never both for the same booking.
          </p>
        </Card>
      )}

      {step === 'confirmed' && booking && (
        <Card>
          <div className="mb-4">
            <SuccessBanner
              message={
                <span className="flex items-center gap-1.5">
                  <Icon name="celebration" className="text-[20px]" />
                  Booking confirmed!
                </span>
              }
            />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Order ID</dt>
              <dd className="font-medium">{booking.orderId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">When</dt>
              <dd className="font-medium">{new Date(booking.startTime).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Amount</dt>
              <dd className="font-medium">
                {booking.currency} {booking.amount}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Status</dt>
              <dd>
                <Badge value={booking.status} />
              </dd>
            </div>
          </dl>
          <Button className="mt-6 w-full" onClick={() => router.push(`/bookings/${booking.id}`)}>
            View Booking
          </Button>
        </Card>
      )}
    </Screen>
  );
}
