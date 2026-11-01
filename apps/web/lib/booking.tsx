import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { trustedMapsUrl } from '@/lib/maps';
import { DISMISSED, useCustomer } from '@/lib/customer';
import { useToast } from '@/components/toast';

export interface SearchResult {
  venue: { id: string; name: string; facilityCode: string; address: string; photoUrl: string | null; lat: number; lng: number; googleMapsUrl?: string | null };
  /** photoUrls: the unit's photos (up to three, main one first); empty when the owner has added none. */
  resource: { id: string; name: string; groundType: string; photoUrls?: string[] };
  category?: { slug: string; name: string; iconKey: string; iconSvg?: string | null; unitLabel: string; venueLabel: string };
  distanceKm?: number;
  /** The length (minutes) the start times and prices are for: the one asked for where this unit offers it, else its shortest. */
  durationMinutes?: number;
  availableStartTimes: string[];
  /** The venue's resolved booking rules — what durations/starts it offers. */
  policy?: {
    slotIntervalMin: number;
    minDurationMin: number;
    maxDurationMin: number;
    durationIncrementMin: number;
    durations: number[];
  };
  /** Venue-local opening windows ("HH:mm"); null = no hours configured. */
  openWindows?: Array<{ openTime: string; closeTime: string }> | null;
  /** IANA zone the venue's times are expressed in. */
  timezone: string;
  /** The lowest price across the available start times. */
  price: SlotPrice | null;
  /** Full price of each start time, aligned with availableStartTimes (prices can differ by day and time of day). */
  startPrices?: Array<string | null>;
  /** Normal price of each start time that has an offer (null where there is none). */
  startNormalPrices?: Array<string | null>;
  /** The advance paid online for each start time. */
  startBookingPrices?: Array<string | null>;
}

/**
 * What a slot costs: `amount` is the full price (the offer price when there is one), `normalAmount` the
 * struck-through normal price (only with an offer), `bookingAmount` the advance paid online to hold it.
 */
export interface SlotPrice {
  amount: string;
  currency: string;
  normalAmount?: string | null;
  bookingAmount?: string | null;
}

/** A date as YYYY-MM-DD in the customer's own calendar (toISOString would give the UTC day, a day behind in India until 5:30 AM). */
export function localIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayIso(): string {
  return localIso(new Date());
}

/** "6:00 AM – 7:00 AM" — the end time customers actually need to know
 * before booking, not just when the slot starts. */
export function formatTimeRange(startIso: string, durationMinutes: number, timeZone?: string): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Start times are shown in the VENUE's timezone, not the browser's. */
export function formatStart(startIso: string, timeZone?: string): string {
  return new Date(startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
}

/** "₹550" — symbol + compact value, falling back to "CODE 550" for
 * unknown currencies. Prisma serializes Decimal as e.g. "550.00", so
 * whole amounts render without the trailing decimals. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
};

/** What a slot starting at `start` costs; falls back to the lowest price for an older API response. */
export function priceAt(
  r: Pick<SearchResult, 'price' | 'startPrices' | 'startNormalPrices' | 'startBookingPrices' | 'availableStartTimes'>,
  start: string | null,
): SlotPrice | null {
  if (!r.price) return null;
  const i = start ? r.availableStartTimes.indexOf(start) : -1;
  const amount = i >= 0 ? r.startPrices?.[i] : undefined;
  if (!amount) return r.price;
  return {
    amount,
    currency: r.price.currency,
    normalAmount: r.startNormalPrices?.[i] ?? null,
    bookingAmount: r.startBookingPrices?.[i] ?? r.price.bookingAmount ?? null,
  };
}

/** "Pay ₹300 now" when only part of the price is charged online; empty when it is all of it. */
export function payNowLabel(price: SlotPrice): string {
  if (!price.bookingAmount) return '';
  return Number(price.bookingAmount) < Number(price.amount)
    ? `Pay ${formatPrice({ amount: price.bookingAmount, currency: price.currency })} now`
    : '';
}

export function formatPrice(price: { amount: string; currency: string }): string {
  const n = Number(price.amount);
  const value = Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : price.amount;
  const symbol = CURRENCY_SYMBOLS[price.currency?.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${price.currency} ${value}`;
}

/**
 * Where a venue's Directions button goes: the Google Maps link the venue saved, otherwise a route to its map
 * pin (opens directions from wherever the customer is). Only a venue with no coordinates falls back to a search
 * by name and address.
 */
export function googleMapsLink(venue: { googleMapsUrl?: string | null; lat?: number; lng?: number; name: string; address: string }): string {
  const own = trustedMapsUrl(venue.googleMapsUrl);
  if (own) return own;
  if (venue.lat !== undefined && venue.lng !== undefined) {
    return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;
}

/**
 * Holds a slot for the logged-in customer and sends them to checkout. Logged
 * out, it opens the login dialog first and carries on once they are in. The
 * server decides whether the slot is still free; its message (e.g. "just
 * taken") is shown as `error`. `busy` stays set after success until the
 * navigation finishes, so a second tap cannot create a second hold.
 */
export function useBookSlot(resourceId: string, durationMinutes: number) {
  const router = useRouter();
  const { requireLogin, refresh } = useCustomer();
  const toast = useToast();
  const [busyStart, setBusyStart] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function bookSlot(startTime: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyStart(startTime);
    setError(null);
    try {
      await requireLogin(); // may open the login dialog; rejects if dismissed
      const hold = await api.post<{ id: string }>('/bookings/hold', { resourceId, startTime, durationMinutes });
      router.push(`/checkout/${hold.id}`);
    } catch (err) {
      inFlight.current = false;
      setBusyStart(null);
      if (err instanceof Error && err.message === DISMISSED) return;
      // Booking needs a verified email or phone: take them to the profile, where the Verify button is.
      if (err instanceof ApiError && (err.details as { code?: string } | undefined)?.code === 'CONTACT_NOT_VERIFIED') {
        toast.show(err.message);
        await refresh().catch(() => undefined); // the profile must show the account as the server sees it now
        router.push('/account?tab=profile&verify=email');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not hold that slot. Please try another.');
    }
  }

  return { bookSlot, busyStart, error, clearError: () => setError(null) };
}

/** "Fri, 26 Sep" for modal headings — the search form carries an ISO date. */
export function formatDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The booking page for one unit of a venue on a day, at a length (the Book Now button of a card goes here). */
export function bookingHref(facilityCode: string, resourceId: string, dateIso: string, durationMinutes: number): string {
  return `/book/${encodeURIComponent(facilityCode)}/${encodeURIComponent(resourceId)}?date=${dateIso}&duration=${durationMinutes}`;
}
