'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { DISMISSED, useCustomer } from '@/lib/customer';
import { ErrorBanner, Icon } from '@/components/ui';
import { SearchingBar, Skeleton, VenueCardsSkeleton } from '@/components/skeleton';
import { AccountMenu } from '@/components/account-menu';
import { useToast } from '@/components/toast';
import { LocationPicker } from '@/components/location-picker';
import { headerLines, locationParams, useLocationChoice } from '@/lib/location';
import { durationLabel, shortDuration, type VenueCategory } from '@/lib/categories';

interface SearchResult {
  venue: { id: string; name: string; facilityCode: string; address: string; photoUrl: string | null; lat: number; lng: number; googleMapsUrl?: string | null };
  resource: { id: string; name: string; groundType: string };
  category?: { slug: string; name: string; iconKey: string; unitLabel: string; venueLabel: string };
  distanceKm?: number;
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

// Shown when the search result carries no bookable windows to size the timeline from.
const DEFAULT_TIMELINE = { first: 6, last: 23 };

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "6:00 AM – 7:00 AM" — the end time customers actually need to know
 * before booking, not just when the slot starts. */
function formatTimeRange(startIso: string, durationMinutes: number, timeZone?: string): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Start times are shown in the VENUE's timezone, not the browser's. */
function formatStart(startIso: string, timeZone?: string): string {
  return new Date(startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
}

/** Hour of day (0–23) of an instant in the venue's own timezone. */
function hourInZone(iso: string, timeZone: string): number {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso)),
  );
  return Number.isFinite(h) ? h % 24 : new Date(iso).getHours();
}

/**
 * The day-timeline bars for one result: one per hour the venue is open
 * (derived from its opening windows, 06:00–23:00 when none are set), lit
 * when at least one bookable start falls inside that hour. Works for any
 * slot interval, including 30-minute starts.
 */
function buildTimeline(r: SearchResult) {
  let first = DEFAULT_TIMELINE.first;
  let last = DEFAULT_TIMELINE.last;
  if (r.openWindows && r.openWindows.length > 0) {
    const opens = r.openWindows.map((w) => Number(w.openTime.slice(0, 2)));
    const closes = r.openWindows.map((w) => {
      const [h, m] = w.closeTime.split(':').map(Number);
      return (m ?? 0) > 0 ? (h ?? 0) + 1 : (h ?? 0);
    });
    first = Math.min(...opens);
    last = Math.max(...closes) - 1;
  }
  if (!(last >= first)) {
    first = DEFAULT_TIMELINE.first;
    last = DEFAULT_TIMELINE.last;
  }
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  const available = new Set(r.availableStartTimes.map((t) => hourInZone(t, r.timezone)));
  const mid = first + Math.floor((last + 1 - first) / 2);
  return {
    hours,
    available,
    labels: [hourLabel(first), hourLabel(mid), hourLabel((last + 1) % 24)] as const,
  };
}

function hourLabel(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '');
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
function priceAt(
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
function payNowLabel(price: SlotPrice): string {
  if (!price.bookingAmount) return '';
  return Number(price.bookingAmount) < Number(price.amount)
    ? `Pay ${formatPrice({ amount: price.bookingAmount, currency: price.currency })} now`
    : '';
}

function formatPrice(price: { amount: string; currency: string }): string {
  const n = Number(price.amount);
  const value = Number.isFinite(n) ? String(n) : price.amount;
  const symbol = CURRENCY_SYMBOLS[price.currency?.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${price.currency} ${value}`;
}

/**
 * Where a venue's Directions button goes: the Google Maps link the venue saved, otherwise a route to its map
 * pin (opens directions from wherever the customer is). Only a venue with no coordinates falls back to a search
 * by name and address.
 */
function googleMapsLink(venue: { googleMapsUrl?: string | null; lat?: number; lng?: number; name: string; address: string }): string {
  if (venue.googleMapsUrl) return venue.googleMapsUrl;
  if (venue.lat !== undefined && venue.lng !== undefined) {
    return `https://www.google.com/maps/dir/?api=1&destination=${venue.lat},${venue.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address}`)}`;
}

const DEFAULT_DAY_COUNT = 7;
const MOST_DAYS = 14;

/** The next `count` calendar days (today first), for the 1-tap date strip. */
function nextDays(count: number): Array<{ iso: string; weekday: string; day: string; month: string; isToday: boolean }> {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: d.toISOString().slice(0, 10),
      weekday: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
      day: String(d.getDate()).padStart(2, '0'),
      month: d.toLocaleDateString([], { month: 'short' }),
      isToday: i === 0,
    };
  });
}

/**
 * Holds a slot for the logged-in customer and sends them to checkout. Logged
 * out, it opens the login dialog first and carries on once they are in. The
 * server decides whether the slot is still free; its message (e.g. "just
 * taken") is shown as `error`. `busy` stays set after success until the
 * navigation finishes, so a second tap cannot create a second hold.
 */
function useBookSlot(resourceId: string, durationMinutes: number) {
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

export default function HomePage() {
  // Where to search: the saved choice, otherwise Malappuram. Nothing is searched until that is known.
  const { choice, setChoice, ready } = useLocationChoice();
  const [pickerOpen, setPickerOpen] = useState(false);

  const [form, setForm] = useState({
    categorySlug: '',
    groundType: '',
    date: todayIso(),
    timeWindow: 'ALL',
    durationMinutes: 60,
  });

  const [nameFilter, setNameFilter] = useState('');
  // The text filter is applied by the server (so it covers venues not loaded yet), once typing pauses.
  const searchText = useDebounced(nameFilter.trim(), 350);

  // Active venue types (Super-Admin managed) drive the filter chips.
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  // Cards come ten at a time: where the next ten start (null = that was all), and the state of fetching them.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // How many days to offer: the most any venue here allows booking ahead (7 until the first search says otherwise).
  const [dayCount, setDayCount] = useState(DEFAULT_DAY_COUNT);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<VenueCategory[]>('/categories?available=true')
      .then(setCategories)
      .catch(() => undefined)
      .finally(() => setCategoriesLoading(false));
  }, []);

  // Searches can overlap (the default place, then a chosen place, then another day) and finish in any order: only the
  // newest one may put its answer on the page, so a slow old search can never overwrite a newer one.
  const latestSearch = useRef(0);
  const PAGE_SIZE = 10;
  // Changing a card's duration re-searches; the cards already loaded stay (so the open card doesn't vanish).
  const keepLoaded = useRef(false);
  const loadedCount = useRef(0);
  loadedCount.current = results.length;

  const searchPath = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({
        date: form.date,
        timeWindow: form.timeWindow,
        durationMinutes: String(form.durationMinutes),
        limit: String(!cursor && keepLoaded.current ? Math.min(50, Math.max(PAGE_SIZE, loadedCount.current)) : PAGE_SIZE),
        ...locationParams(choice!),
      });
      // Both filters are optional: no category = every venue type, no sub-type = every kind of unit. The API owns the filtering.
      if (form.categorySlug) params.set('categorySlug', form.categorySlug);
      if (form.groundType) params.set('groundType', form.groundType);
      if (searchText) params.set('q', searchText);
      if (cursor) params.set('cursor', cursor);
      return `/search?${params.toString()}`;
    },
    [choice, form.categorySlug, form.groundType, form.date, form.timeWindow, form.durationMinutes, searchText],
  );

  /** A new search: the first ten cards. Anything still loading from an earlier search is ignored from now on. */
  const runSearch = useCallback(async () => {
    if (!choice) return;
    const mine = ++latestSearch.current;
    setSearching(true);
    setLoadingMore(false);
    setMoreError(null);
    setErrorMessage(null);
    try {
      const page = await api.getPage<SearchResult[]>(searchPath());
      keepLoaded.current = false;
      if (mine !== latestSearch.current) return;
      setResults(page.data);
      setNextCursor(page.nextCursor);
      setSearched(true);
      if (page.advanceDays) {
        const count = Math.min(MOST_DAYS, Math.max(1, page.advanceDays));
        setDayCount(count);
        // A chosen day that is no longer on offer (a new place allows fewer days) falls back to today.
        setForm((f) => (nextDays(count).some((d) => d.iso === f.date) ? f : { ...f, date: todayIso() }));
      }
    } catch (err) {
      if (mine !== latestSearch.current) return;
      setErrorMessage(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      if (mine === latestSearch.current) setSearching(false);
    }
  }, [choice, searchPath]);

  /** The next ten, added below the ones already shown. */
  const loadMore = useCallback(async () => {
    if (!choice || !nextCursor || loadingMore || searching) return;
    const mine = latestSearch.current; // a new search while this loads makes the answer stale
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.getPage<SearchResult[]>(searchPath(nextCursor));
      if (mine !== latestSearch.current) return;
      setResults((current) => {
        const seen = new Set(current.map((r) => `${r.venue.id}/${r.resource.id}`));
        return [...current, ...page.data.filter((r) => !seen.has(`${r.venue.id}/${r.resource.id}`))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mine !== latestSearch.current) return;
      setMoreError(err instanceof ApiError ? err.message : 'Could not load more venues.');
    } finally {
      if (mine === latestSearch.current) setLoadingMore(false);
    }
  }, [choice, nextCursor, loadingMore, searching, searchPath]);

  // Re-search automatically whenever the place or a filter changes: no separate submit button to hunt for.
  useEffect(() => {
    if (ready && choice) runSearch();
  }, [ready, runSearch]);

  // Scrolling near the end of the list loads the next ten. The watcher is set up again after every load, so it
  // also fires straight away if the list is still too short to fill the screen.
  const endOfList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = endOfList.current;
    if (!el || !nextCursor || loadingMore || searching || moreError) return;
    const watcher = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '500px 0px' },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [nextCursor, loadingMore, searching, moreError, results.length, loadMore]);

  // Shown in the order the server gave: nearest first for a location search, otherwise by venue name.
  const visibleResults = results;

  const activeCategory = categories.find((c) => c.slug === form.categorySlug);

  function selectCategory(slug: string) {
    const category = categories.find((c) => c.slug === slug);
    setForm((f) => ({
      ...f,
      categorySlug: slug,
      groundType: '',
      // Start from the type's shortest booking; "All" keeps the usual hour.
      durationMinutes: category ? category.policy.minDurationMin : 60,
    }));
  }

  const days = useMemo(() => nextDays(dayCount), [dayCount]);

  const { title: locationTitle, subtitle: locationSubtitle } = headerLines(choice);

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-emerald-900/10 pt-3 pb-0">
        <div className="w-full px-4 sm:px-6 lg:px-10 2xl:px-14">
        {/* Top row: location · (search, inline from md up) · account. Below md the search box wraps to its own full-width row. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 md:flex-nowrap md:gap-x-6">
          <button onClick={() => setPickerOpen(true)} aria-label={`Change location, now ${locationTitle}`} aria-haspopup="dialog" className="flex items-center gap-2 text-slate-700 hover:text-slate-900 transition py-1 text-left group md:order-1" type="button">
            <svg className="w-6 h-6 text-brand-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"></path></svg>
            <div className="flex flex-col items-start text-left">
              <span className="font-black text-slate-900 text-sm tracking-tight leading-tight">{locationTitle}</span>
              <span className="text-[0.625rem] font-medium text-slate-500 leading-tight">
                {locationSubtitle}
              </span>
            </div>
          </button>
          <div className="md:order-3">
            <AccountMenu />
          </div>
        <div className="relative order-last mt-2.5 w-full md:order-2 md:mt-0 md:w-auto md:max-w-xl md:flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
          </div>
          <input 
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-xs font-medium bg-[#F4F6F5] rounded-xl border border-slate-200/90 shadow-subtle placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all text-slate-800" 
            placeholder="Search venues, names or areas..." type="text" />
          <button onClick={() => setNameFilter('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path></svg>
          </button>
        </div>
        </div>
        <div className="flex items-center overflow-x-auto scrollbar-hide scroll-smooth pt-2.5 -mx-4 sm:-mx-6 lg:-mx-8">
          {[{ slug: '', name: 'All', iconKey: 'apps' }, ...categories].map((c) => {
            const isActive = form.categorySlug === c.slug;
            return (
              <button
                key={c.slug || 'all'}
                type="button"
                onClick={() => selectCategory(c.slug)}
                className={`flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs transition ${isActive ? 'text-emerald-700 border-b-2 border-emerald-600 font-bold' : 'font-semibold text-slate-600 hover:text-slate-900 border-b-2 border-transparent border-r border-slate-100'}`}
              >
                <Icon name={c.iconKey} className={`text-[1rem] ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{c.name}</span>
              </button>
            );
          })}
          {categoriesLoading &&
            [0, 1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" className="flex-shrink-0 px-4 py-2.5">
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
        </div>
        {activeCategory && activeCategory.unitTypes.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto py-2 scrollbar-hide">
            {[{ value: '', label: `Any ${activeCategory.unitLabel.toLowerCase()}` }, ...activeCategory.unitTypes.map((t) => ({ value: t, label: t }))].map((t) => {
              const isActive = form.groundType === t.value;
              return (
                <button
                  key={t.value || 'any'}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, groundType: t.value }))}
                  aria-pressed={isActive}
                  className={`flex-shrink-0 rounded-full border px-3 py-1 text-[0.6875rem] font-bold transition ${isActive ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400'}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
        </div>
      </header>

      <section className="pb-3 pt-4">
        <div className="flex w-full items-center space-x-2 overflow-x-auto px-4 scrollbar-hide scroll-smooth sm:space-x-3 sm:px-6 lg:px-10 2xl:px-14">
          {days.map((d) => {
            const isActive = form.date === d.iso;
            return (
              <button 
                key={d.iso} 
                onClick={() => setForm((f) => ({ ...f, date: d.iso }))}
                className={`flex-shrink-0 flex flex-col items-center justify-center py-2.5 px-3.5 rounded-2xl min-w-[64px] sm:min-w-[84px] sm:py-3 transition-all active:scale-95 ${isActive ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand-500/40 shadow-lg border border-brand-400' : 'bg-white border border-slate-200 text-slate-800 hover:border-slate-300 shadow-sm'}`}
              >
                <span className={`text-[0.5625rem] uppercase leading-none ${isActive ? 'font-extrabold tracking-wider text-brand-100' : 'font-bold text-slate-400'}`}>{d.weekday}</span>
                <span className={`text-lg font-black my-0.5 leading-tight ${isActive ? '' : 'text-slate-900'}`}>{d.day}</span>
                <span className={`text-[0.625rem] leading-none ${isActive ? 'font-semibold text-brand-50' : 'font-medium text-slate-400'}`}>{d.month}</span>
              </button>
            );
          })}
        </div>
      </section>

      <main className="w-full flex-1 px-4 pb-24 sm:px-6 lg:px-10 2xl:px-14">
        {errorMessage && <div className="mb-4"><ErrorBanner message={errorMessage} /></div>}
        {/* The first search shows the shape of the results; a re-search keeps the old results and shows a slim bar. */}
        {searching && (results.length === 0 ? <VenueCardsSkeleton /> : <SearchingBar />)}
        {!searching && searched && visibleResults.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            {choice && choice.mode !== 'district' ? (
              <>
                <p>No venues are open near {choice.mode === 'town' ? choice.townName : 'you'} for that search.</p>
                <button
                  type="button"
                  onClick={() =>
                    setChoice({
                      mode: 'district',
                      stateId: choice.stateId,
                      stateName: choice.stateName,
                      districtId: choice.districtId,
                      districtName: choice.districtName,
                    })
                  }
                  className="mt-4 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  Browse all of {choice.districtName}
                </button>
              </>
            ) : (
              'Nothing available for that search. Try a different time, date, type, or location.'
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:gap-5">
          {groupByVenue(visibleResults).map((group) => (
            <VenueGroupCard
              key={group.venue.id}
              venue={group.venue}
              units={group.units}
              // The modals edit the duration, which re-searches: look each unit up in the live results so an open
              // modal refreshes its slots and prices instead of going stale.
              liveFor={(r) => results.find((x) => x.venue.id === r.venue.id && x.resource.id === r.resource.id) ?? r}
              durationMinutes={form.durationMinutes}
              dateIso={form.date}
              reloading={searching}
              onDurationChange={(m: number) => {
                keepLoaded.current = true;
                setForm((f) => ({ ...f, durationMinutes: m }));
              }}
            />
          ))}
        </div>

        {visibleResults.length > 0 && (
          <>
            {loadingMore && (
              <div className="mt-3 sm:mt-5">
                <div role="status" className="flex items-center justify-center gap-2 py-2 text-xs font-medium text-slate-500">
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600 motion-reduce:animate-none" />
                  Loading more venues…
                </div>
                <VenueCardsSkeleton count={2} label="Loading the next venues" />
              </div>
            )}
            {moreError && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <ErrorBanner message={moreError} />
                <button type="button" onClick={() => void loadMore()} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">
                  Try again
                </button>
              </div>
            )}
            {/* Scrolling this line into view (a little early) fetches the next ten. */}
            <div ref={endOfList} aria-hidden="true" className="h-px" />
            {!nextCursor && !searching && !loadingMore && (
              <p className="py-8 text-center text-xs font-medium text-slate-400">That is every venue for this search.</p>
            )}
          </>
        )}
      </main>

      {pickerOpen && (
        <LocationPicker
          current={choice}
          onChoose={(next) => {
            setChoice(next);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

/** "Fri, 26 Sep" for modal headings — the search form carries an ISO date. */
function formatDateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Detailed booking modal opened from "Book Now": venue summary, date /
 * resource / price, and the full available-slot grid for the searched
 * day. Picking a slot enables "Book", which holds it and moves on to
 * checkout (logging the customer in first when needed).
 */
function SlotBookingModal({
  result: r,
  durationMinutes,
  dateIso,
  reloading,
  onDurationChange,
  onClose,
}: {
  result: SearchResult;
  durationMinutes: number;
  dateIso: string;
  reloading: boolean;
  onDurationChange: (minutes: number) => void;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Durations come from the venue's own booking rules, not constants.
  const step = r.policy?.durationIncrementMin ?? 60;
  const minDuration = r.policy?.minDurationMin ?? 60;
  const maxDuration = r.policy?.maxDurationMin ?? 180;
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new duration invalidates the picked start time.
  useEffect(() => {
    setSelected(null);
  }, [durationMinutes]);

  // While a new duration is being searched the price is unknown (each
  // length has its own price), so none is shown rather than a guess.
  const displayPrice = reloading ? null : r.price;

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function beginClose() {
    setShown(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 280);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') beginClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const { bookSlot, busyStart, error: bookError, clearError } = useBookSlot(r.resource.id, durationMinutes);
  const booking = busyStart !== null;

  // A different slot or length makes an old "just taken" message stale.
  useEffect(() => {
    clearError();
  }, [selected, durationMinutes]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Book ${r.venue.name}`}>
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`}
        onClick={beginClose}
        aria-hidden="true"
      />
      <div
        className={`relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl transition-all duration-300 ease-out will-change-transform sm:rounded-3xl ${
          shown ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            {r.venue.photoUrl ? (
              <img
                src={r.venue.photoUrl}
                alt={`${r.venue.name} logo`}
                className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
                <Icon name={r.category?.iconKey ?? 'category'} className="text-[1.5rem]" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-emerald-700">Book your slot</p>
              <h3 className="mt-0.5 truncate text-lg font-black tracking-tight text-slate-900">{r.venue.name}</h3>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {r.venue.address}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <a
                  href={googleMapsLink(r.venue)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-1 text-[0.6875rem] font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
                >
                  <Icon name="location_on" className="text-[0.875rem]" />
                  Directions
                </a>
              </div>
            </div>
          </div>
          <button type="button" onClick={beginClose} aria-label="Close" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Icon name="close" className="text-[1.25rem]" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
            {formatDateLabel(dateIso)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
            {r.resource.groundType ? `${r.resource.name} · ${r.resource.groundType}` : r.resource.name}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white py-0.5 pl-1 pr-2 font-bold text-slate-700 ring-1 ring-slate-200">
            <button
              type="button"
              aria-label="Shorter booking"
              disabled={durationMinutes - step < minDuration}
              onClick={() => onDurationChange(durationMinutes - step)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              −
            </button>
            <span className="min-w-16 px-1 text-center">{durationLabel(durationMinutes)}</span>
            <button
              type="button"
              aria-label="Longer booking"
              disabled={durationMinutes + step > maxDuration}
              onClick={() => onDurationChange(durationMinutes + step)}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              +
            </button>
          </span>
        </div>

        <div className={`flex-1 overflow-y-auto p-5 transition-opacity ${reloading ? 'pointer-events-none opacity-50' : ''}`}>
          <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">
            {reloading
              ? 'Updating slots…'
              : `${r.availableStartTimes.length} slot${r.availableStartTimes.length === 1 ? '' : 's'} available — tap to select`}
          </p>
          {/* Three rows visible — the rest scrolls inside the grid. */}
          <div className="grid max-h-[152px] grid-cols-2 gap-2 overflow-y-auto pr-0.5">
            {r.availableStartTimes.map((t) => {
              const active = selected === t;
              const slotPrice = reloading ? null : priceAt(r, t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelected(t)}
                  aria-pressed={active}
                  className={`flex items-center justify-between gap-2 rounded-xl border-2 px-3 py-2.5 text-left transition-all active:scale-95 ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-800 hover:border-emerald-400 hover:bg-emerald-50/50'
                  }`}
                >
                  <span className={`text-sm font-extrabold ${active ? 'text-white' : 'text-slate-900'}`}>
                    {formatStart(t, r.timezone)}
                  </span>
                  {slotPrice && (
                    <span className={`shrink-0 text-[0.6875rem] font-black ${active ? 'text-emerald-100' : 'text-emerald-700'}`}>
                      {formatPrice(slotPrice)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-white p-4">
          {selected && (
            <p className="mb-2 text-center text-xs font-semibold text-slate-600">
              {formatDateLabel(dateIso)} · {formatTimeRange(selected, durationMinutes, r.timezone)} · {displayPrice && priceAt(r, selected) ? formatPrice(priceAt(r, selected)!) : ''}
              {displayPrice && priceAt(r, selected)?.normalAmount && (
                <s className="ml-1 font-medium text-slate-400">{formatPrice({ amount: priceAt(r, selected)!.normalAmount!, currency: r.price!.currency })}</s>
              )}
              {displayPrice && priceAt(r, selected) && payNowLabel(priceAt(r, selected)!) && (
                <span className="block text-emerald-700">{payNowLabel(priceAt(r, selected)!)}, the rest at the venue</span>
              )}
            </p>
          )}
          {bookError && (
            <div role="alert" className="mb-2">
              <ErrorBanner message={bookError} />
            </div>
          )}
          <button
            type="button"
            disabled={!selected || booking || reloading}
            onClick={() => selected && bookSlot(selected)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:active:scale-100"
          >
            {booking && (
              <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {booking
              ? 'Holding your slot…'
              : selected
                ? `Book ${formatStart(selected, r.timezone)}`
                : 'Select a slot above'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a venue's card is told about each of its units: the live result (it refreshes while a modal is open) and the one shown. */
interface UnitCardProps {
  result: SearchResult;
  liveResult: SearchResult;
  durationMinutes: number;
  dateIso: string;
  reloading: boolean;
  onDurationChange: (minutes: number) => void;
}

/** The venues in the order the server gave them, each with its units (turfs, courts...) together. */
function groupByVenue(results: SearchResult[]): Array<{ venue: SearchResult['venue']; units: SearchResult[] }> {
  const groups = new Map<string, { venue: SearchResult['venue']; units: SearchResult[] }>();
  for (const r of results) {
    const group = groups.get(r.venue.id);
    if (group) group.units.push(r);
    else groups.set(r.venue.id, { venue: r.venue, units: [r] });
  }
  return [...groups.values()];
}

/**
 * One card per venue, with each of its units (two turfs, a turf and a court...) listed inside it, each with its
 * own price, timeline and slots. The venue's name, address and Directions are shown once, at the top.
 */
function VenueGroupCard({
  venue,
  units,
  liveFor,
  ...unitProps
}: {
  venue: SearchResult['venue'];
  units: SearchResult[];
  liveFor: (r: SearchResult) => SearchResult;
} & Omit<UnitCardProps, 'result' | 'liveResult'>) {
  // The icon is the facility's when the venue offers one kind of unit, a generic one when it mixes them.
  const iconKeys = new Set(units.map((u) => u.category?.iconKey ?? 'category'));
  const icon = iconKeys.size === 1 ? [...iconKeys][0]! : 'category';
  const openSlots = units.reduce((n, u) => n + u.availableStartTimes.length, 0);

  return (
    <article
      aria-label={venue.name}
      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-card transition-all duration-300 hover:border-emerald-500/40 sm:shadow-sm sm:hover:shadow-lg"
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-white p-4 sm:p-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="relative shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-emerald-500/30 bg-slate-50 text-emerald-600 shadow-sm">
              <Icon name={icon} className="text-[1.75rem]" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-emerald-500">
              <svg className="h-2 w-2 text-white" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-black leading-snug tracking-tight text-slate-900 sm:text-xl sm:font-bold">{venue.name}</h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
              <Icon name="location_on" className="shrink-0 text-[0.875rem] text-brand-600" />
              <span className="truncate">{venue.address}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <a
                href={googleMapsLink(venue)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-1 text-[0.6875rem] font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
              >
                <Icon name="location_on" className="text-[0.875rem]" />
                Directions
              </a>
              <span className="text-[0.6875rem] font-semibold text-slate-400">
                {units.length} {units.length === 1 ? 'option' : 'options'} · {openSlots} slot{openSlots === 1 ? '' : 's'} open
              </span>
            </div>
          </div>
        </div>
      </header>

      <div className="divide-y divide-slate-100">
        {units.map((unit) => {
          const props = { ...unitProps, result: unit, liveResult: liveFor(unit) };
          return (
            <section key={unit.resource.id} aria-label={`${venue.name}, ${unit.resource.name}`}>
              <MobileUnit {...props} />
              <DesktopUnit {...props} />
            </section>
          );
        })}
      </div>
    </article>
  );
}

/** A small curved box with the unit's facility icon. */
function UnitIcon({ r, className = '' }: { r: SearchResult; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 ${className}`}>
      <Icon name={r.category?.iconKey ?? 'category'} className="text-[1.25rem]" />
    </div>
  );
}

/** Phone layout of one unit inside its venue's card: name and price, then the day timeline and Book. */
function MobileUnit({ result: r, liveResult, durationMinutes, dateIso, reloading, onDurationChange }: UnitCardProps) {
  const hasSlots = r.availableStartTimes.length > 0;
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const timeline = useMemo(() => buildTimeline(r), [r]);

  return (
    <>
      <div className="flex flex-col gap-3 px-4 pt-4 sm:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <UnitIcon r={r} className="h-10 w-10" />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-extrabold text-slate-900">{r.resource.name}</h3>
              {r.resource.groundType && (
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-emerald-800">
                  {r.resource.groundType}
                </span>
              )}
            </div>
          </div>
          {r.price && (
            <div className="shrink-0 rounded-xl border border-emerald-500/20 bg-emerald-50 px-2.5 py-1 text-right">
              <span className="block text-[0.5625rem] font-bold uppercase leading-none text-emerald-700">From</span>
              <div className="mt-0.5 flex items-baseline justify-end leading-tight text-venue-primary">
                {r.price.normalAmount && (
                  <s className="mr-1 text-[0.6875rem] font-medium text-slate-400">{formatPrice({ amount: r.price.normalAmount, currency: r.price.currency })}</s>
                )}
                <span className="text-base font-black tracking-tight">{formatPrice(r.price)}</span>
                <span className="ml-0.5 text-[0.625rem] font-medium text-slate-500">/{shortDuration(durationMinutes)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="-mx-4 border-t border-emerald-500/20">
          <div className="flex flex-col gap-2 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between text-[0.625rem]">
              <span className="text-[0.625rem] font-extrabold uppercase tracking-wider text-slate-800">DAY TIMELINE OCCUPANCY</span>
              <div className="flex flex-wrap items-center gap-2 text-[0.5625rem] font-medium text-slate-500">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Available</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> Booked</span>
              </div>
            </div>
            <div className="flex w-full items-center gap-1">
              {timeline.hours.map((h) =>
                timeline.available.has(h) ? (
                  <div key={h} title={`${hourLabel(h)} - Available`} className="h-2 flex-1 rounded-sm bg-emerald-500 shadow-sm" />
                ) : (
                  <div key={h} title={`${hourLabel(h)} - Booked`} className="h-2 flex-1 rounded-sm bg-slate-200" />
                ),
              )}
            </div>
            <div className="flex items-center justify-between px-0.5 text-[0.5625rem] font-bold text-slate-400">
              <span>{timeline.labels[0]}</span>
              <span>{timeline.labels[1]}</span>
              <span>{timeline.labels[2]}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-emerald-500/20 pt-2">
              <button
                type="button"
                onClick={() => hasSlots && setSlotModalOpen(true)}
                disabled={!hasSlots}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold text-white shadow-sm transition active:scale-95 ${hasSlots ? 'bg-emerald-600 hover:bg-emerald-700' : 'cursor-not-allowed bg-slate-400'}`}
              >
                <Icon name="bolt" className="text-[0.875rem]" />
                <span>{hasSlots ? `Book Now · ${r.availableStartTimes.length} slots` : 'No Slots Today'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {slotModalOpen && (
        <SlotBookingModal
          result={liveResult}
          durationMinutes={durationMinutes}
          dateIso={dateIso}
          reloading={reloading}
          onDurationChange={onDurationChange}
          onClose={() => setSlotModalOpen(false)}
        />
      )}
    </>
  );
}

/** Desktop layout of one unit inside its venue's card: name, price and Book Now on the left; timeline and slots on the right. */
function DesktopUnit({ result: r, liveResult, durationMinutes, dateIso, reloading, onDurationChange }: UnitCardProps) {
  const hasSlots = r.availableStartTimes.length > 0;
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const { bookSlot, busyStart, error: bookError } = useBookSlot(r.resource.id, durationMinutes);

  return (
    <>
      <div className="hidden grid-cols-1 sm:grid lg:grid-cols-12 lg:divide-x lg:divide-slate-100">
        {/* Left: the unit */}
        <div className="flex flex-col justify-between p-5 sm:p-6 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3.5">
              <UnitIcon r={r} className="h-12 w-12" />
              <div className="min-w-0">
                <h3 className="text-lg font-bold leading-snug text-slate-900">{r.resource.name}</h3>
                {r.resource.groundType && (
                  <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[0.625rem] font-bold text-slate-600">
                    {r.resource.groundType}
                  </span>
                )}
              </div>
            </div>
            {r.price && (
              <div className="flex shrink-0 flex-col items-end">
                <span className="text-[0.6875rem] font-semibold text-slate-400">{durationLabel(durationMinutes)} rate</span>
                {r.price.normalAmount && (
                  <s className="text-xs font-medium text-slate-400">{formatPrice({ amount: r.price.normalAmount, currency: r.price.currency })}</s>
                )}
                <span className="text-2xl font-black text-emerald-700">{formatPrice(r.price)}</span>
                {payNowLabel(r.price) && <span className="text-[0.6875rem] font-semibold text-emerald-700">{payNowLabel(r.price)}</span>}
              </div>
            )}
          </div>

          {hasSlots && (
            <div className="mt-5 border-t border-slate-100 pt-3.5">
              <button
                type="button"
                onClick={() => setSlotModalOpen(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:from-emerald-500 hover:to-emerald-600 active:scale-95"
              >
                <Icon name="bolt" className="text-[1.125rem]" />
                Book Now · {r.availableStartTimes.length} slot{r.availableStartTimes.length === 1 ? '' : 's'} open
              </button>
            </div>
          )}
        </div>

        {/* Right: timeline + slot grid */}
        <div className="flex flex-col justify-between bg-slate-50/60 p-5 sm:p-6 lg:col-span-7">
          <div>
            <DayTimeline result={r} />

            <div className="mb-2 mt-3.5 flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-slate-700">
                <Icon name="schedule" className="text-[1rem]" />
                Tap Slot to Instant Book
              </span>
              <span className="text-[0.6875rem] font-semibold text-emerald-700">
                {r.availableStartTimes.length} slot{r.availableStartTimes.length === 1 ? '' : 's'} open
              </span>
            </div>

            {r.availableStartTimes.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
                No open slots for this duration on this day.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {r.availableStartTimes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={busyStart !== null}
                    onClick={() => bookSlot(t)}
                    className="group flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 shadow-sm transition-all hover:border-emerald-600 hover:bg-emerald-600 hover:text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="flex flex-col text-left">
                      <span className="text-xs font-extrabold text-slate-900 group-hover:text-white">{formatStart(t, r.timezone)}</span>
                      {priceAt(r, t) && (
                        <span className="text-[0.625rem] font-bold text-emerald-700 group-hover:text-emerald-100">{formatPrice(priceAt(r, t)!)}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[0.625rem] font-extrabold uppercase text-white group-hover:bg-white group-hover:text-emerald-900">
                      {busyStart === t ? 'Holding…' : 'Book'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {bookError && (
              <div role="alert" className="mt-2">
                <ErrorBanner message={bookError} />
              </div>
            )}
          </div>
        </div>
      </div>
      {slotModalOpen && (
        <SlotBookingModal
          result={liveResult}
          durationMinutes={durationMinutes}
          dateIso={dateIso}
          reloading={reloading}
          onDurationChange={onDurationChange}
          onClose={() => setSlotModalOpen(false)}
        />
      )}
    </>
  );
}

function DayTimeline({ result: r }: { result: SearchResult }) {
  const timeline = useMemo(() => buildTimeline(r), [r]);

  return (
    <div className="mb-3.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-[0.6875rem] font-bold uppercase tracking-wide text-slate-800">Day Timeline</span>
      </div>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-0.5">
        {timeline.hours.map((h) => {
          const t = timeline.available.has(h);
          return t ? (
            <span key={h} className="flex-1 rounded-sm bg-emerald-500" title={`${hourLabel(h)} — available`} />
          ) : (
            <span key={h} className="flex-1 rounded-sm bg-slate-300" title={`${hourLabel(h)} — unavailable`} />
          );
        })}
      </div>
      <div className="flex justify-between pt-1 text-[0.5625rem] font-semibold text-slate-400">
        <span>{timeline.labels[0]}</span>
            <span>{timeline.labels[1]}</span>
            <span>{timeline.labels[2]}</span>
      </div>
    </div>
  );
}

