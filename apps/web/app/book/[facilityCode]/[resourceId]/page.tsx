'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { durationLabel } from '@/lib/categories';
import {
  OfferTag,
  formatDateLabel,
  formatPrice,
  formatStart,
  formatTimeRange,
  googleMapsLink,
  localIso,
  offerOf,
  payNowLabel,
  priceAt,
  todayIso,
  useBookSlot,
  type SearchResult,
} from '@/lib/booking';
import { CategoryIcon, ErrorBanner, Icon } from '@/components/ui';
import { DetailSkeleton } from '@/components/skeleton';
import { readSearch, writeSearch } from '@/lib/search-cache';
import { useSavedVenues } from '@/lib/saved-venues';
import { BrowseHeader } from '@/components/browse-header';

/** The page's frame: the same header as the listing (logo, place, search, venue types, account), then the content (on a phone the header is just a back button and the account). */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <BrowseHeader phoneBack />
      <main className="w-full px-4 pb-10 pt-5 sm:px-6 lg:px-10 2xl:px-14">
        {children}
      </main>
    </div>
  );
}

const MOST_DAYS = 14;

/** What `count` of a pooled item cost: the prices of a slot are for one. */
function totalOf(price: NonNullable<ReturnType<typeof priceAt>>, count: number) {
  return {
    ...price,
    amount: String(Number(price.amount) * count),
    bookingAmount: price.bookingAmount ? String(Number(price.bookingAmount) * count) : price.bookingAmount,
  };
}

/** The next `count` days (today first) for the day strip. */
function nextDays(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: localIso(d),
      weekday: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
      day: String(d.getDate()),
      month: d.toLocaleDateString([], { month: 'short' }),
    };
  });
}

/** The venue's pictures: the unit's own photos first, then the venue's photo; a drawn field with the icon when there are none. */
function Pictures({ unit, venueName, saved, onToggleSave }: { unit: SearchResult; venueName: string; saved: boolean; onToggleSave: () => void }) {
  const offer = offerOf(unit);
  const photos = useMemo(() => {
    const own = unit.resource.photoUrls ?? [];
    return [...own, ...(unit.venue.photoUrl && !own.includes(unit.venue.photoUrl) ? [unit.venue.photoUrl] : [])];
  }, [unit]);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState<string | null>(null); // the picture that has finished loading (it fades in over the grey field)
  const shown = photos[Math.min(index, photos.length - 1)];
  return (
    <div>
      <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-stone-200 sm:aspect-[16/7]">
        {shown ? (
          <img key={shown} src={shown} alt={`${venueName}, ${unit.resource.name}`} onLoad={() => setReady(shown)} className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${ready === shown ? 'opacity-100' : 'opacity-0'}`} />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-100 via-stone-200 to-stone-300">
            <CategoryIcon iconKey={unit.category?.iconKey ?? 'category'} iconSvg={unit.category?.iconSvg} className="text-[6rem] text-stone-500/70" />
          </div>
        )}

        {offer && <OfferTag offer={offer} className="absolute left-3 top-3" />}
        <button
          type="button"
          onClick={onToggleSave}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${venueName} from saved venues` : `Save ${venueName}`}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105 active:scale-95"
        >
          <Icon name="bookmark" className={`text-[1.25rem] ${saved ? 'fill-brand-700 text-brand-700' : 'text-slate-700'}`} />
        </button>
        <a
          href={googleMapsLink(unit.venue)}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-bold text-brand-800 shadow-sm backdrop-blur transition hover:bg-white active:scale-95"
        >
          <Icon name="navigation" className="text-[0.875rem]" />
          Directions
        </a>
      </div>
      {photos.length > 1 && (
        <div className="scrollbar-hide mt-2 flex gap-2 overflow-x-auto">
          {photos.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Photo ${i + 1} of ${photos.length}`}
              aria-current={i === index}
              className={`h-16 w-24 shrink-0 overflow-hidden rounded-lg border-2 transition ${i === index ? 'border-brand-600' : 'border-transparent opacity-70 hover:opacity-100'}`}
            >
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The venue's own page, opened by a card's Book Now: the venue (pictures, address, about), every unit it offers with the one
 * picked on the card selected (the others a tap away), the day, the length, every start time with its price, and Book, which
 * holds the slot and moves on to checkout (logging in first when needed). The address carries the unit, day and length, so it
 * can be shared or reopened.
 */
function BookingPage() {
  const params = useParams<{ facilityCode: string; resourceId: string }>();
  const query = useSearchParams();
  const facilityCode = decodeURIComponent(params.facilityCode);
  // The unit and the day are this page's own state, started from the address. A change rewrites the address in place
  // (history.replaceState) and does not navigate, so only what depends on it changes: the header, the facility tiles and the rest stay.
  const [resourceId, setResourceId] = useState(() => decodeURIComponent(params.resourceId));
  const dateParam = query.get('date');
  const [dateIso, setDateIso] = useState(() => (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso()));
  const durationParam = Number(query.get('duration'));
  const [durationMinutes, setDurationMinutes] = useState<number | null>(Number.isFinite(durationParam) && durationParam > 0 ? durationParam : null);

  const [units, setUnits] = useState<SearchResult[] | null>(null);
  const [dayCount, setDayCount] = useState(MOST_DAYS);
  const [about, setAbout] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const latest = useRef(0);
  const saved = useSavedVenues();

  const go = (next: { resource?: string; date?: string; duration?: number | null }) => {
    const rid = next.resource ?? resourceId;
    const date = next.date ?? dateIso;
    const duration = next.duration === undefined ? durationMinutes : next.duration;
    setResourceId(rid);
    setDateIso(date);
    setDurationMinutes(duration);
    window.history.replaceState(window.history.state, '', `/book/${encodeURIComponent(facilityCode)}/${encodeURIComponent(rid)}?date=${date}${duration ? `&duration=${duration}` : ''}`);
  };

  // The venue's units for that day; only the newest answer may land (a new day or length searches again).
  useEffect(() => {
    const mine = ++latest.current;
    setError(null);
    const search = new URLSearchParams({ facilityCode, date: dateIso, timeWindow: 'ALL', ...(durationMinutes ? { durationMinutes: String(durationMinutes) } : {}) });
    const path = `/search?${search.toString()}`;
    // A repeat of a recent look at this venue paints its saved slots at once; the live answer replaces them a moment later (the API
    // re-checks the slot when it is held, so a stale one can never be booked). With nothing saved the page waits for the answer.
    const saved = readSearch<SearchResult>(path);
    if (saved) {
      setUnits(saved.data);
      if (saved.advanceDays) setDayCount(Math.min(MOST_DAYS, Math.max(1, saved.advanceDays)));
      setLoading(false);
    } else setLoading(true);
    api
      .getPage<SearchResult[]>(path)
      .then((page) => {
        if (mine !== latest.current) return;
        writeSearch<SearchResult>(path, { data: page.data, nextCursor: null, advanceDays: page.advanceDays ?? null });
        if (page.data.length === 0) {
          setUnits(null);
          setError('This venue is not available to book any more.');
        } else setUnits(page.data);
        if (page.advanceDays) setDayCount(Math.min(MOST_DAYS, Math.max(1, page.advanceDays)));
      })
      .catch((err) => mine === latest.current && setError(err instanceof ApiError ? err.message : 'Could not load this venue.'))
      .finally(() => mine === latest.current && setLoading(false));
  }, [facilityCode, dateIso, durationMinutes]);

  // The venue's description, when it has one (the page works without it).
  useEffect(() => {
    const path = `about:${facilityCode}`;
    const saved = readSearch<{ description: string | null }>(path);
    if (saved?.data[0]) setAbout(saved.data[0].description);
    api
      .get<{ description?: string | null }>(`/venues/by-code/${encodeURIComponent(facilityCode)}`)
      .then((v) => {
        const description = v.description?.trim() || null;
        setAbout(description);
        writeSearch(path, { data: [{ description }], nextCursor: null, advanceDays: null });
      })
      .catch(() => undefined);
  }, [facilityCode]);

  const unit = units?.find((u) => u.resource.id === resourceId) ?? units?.[0];

  // A different unit, day or length makes the picked start time stale.
  useEffect(() => setSelected(null), [unit?.resource.id, dateIso, durationMinutes]);

  const shownDuration = unit?.durationMinutes ?? durationMinutes ?? unit?.policy?.minDurationMin ?? 60;
  // A fixed slot has its own length (it runs from its start to its end); the hold is for that length.
  const fixedSlots = unit?.pooled?.slots;
  const pickedSlot = fixedSlots && selected ? fixedSlots[unit!.availableStartTimes.indexOf(selected)] : undefined;
  const holdLength = pickedSlot?.durationMinutes ?? shownDuration;
  const { bookSlot, busyStart, error: bookError, clearError } = useBookSlot(unit?.resource.id ?? resourceId, holdLength, !!unit?.pooled);
  const booking = busyStart !== null;
  // How many of a pooled item (kayaks) the customer is booking.
  const [quantity, setQuantity] = useState(1);
  useEffect(() => setQuantity(1), [selected, unit?.resource.id]);
  useEffect(() => clearError(), [selected, unit?.resource.id, durationMinutes]);

  const days = useMemo(() => nextDays(dayCount), [dayCount]);

  if (!unit || !units) {
    return (
      <Screen>
        {loading && <DetailSkeleton />}
        {!loading && (
          <div className="space-y-4">
            <ErrorBanner message={error ?? 'Could not load this venue.'} />
            <Link href="/explore" className="inline-flex rounded-xl bg-brand-700 px-5 py-3 text-sm font-bold text-white hover:bg-brand-800">
              Back to venues
            </Link>
          </div>
        )}
      </Screen>
    );
  }

  const r = unit;
  // A unit steps through every length its rules allow; a pooled item only through the lengths its owner has priced.
  const step = r.policy?.durationIncrementMin ?? 60;
  const minDuration = r.policy?.minDurationMin ?? 60;
  const maxDuration = r.policy?.maxDurationMin ?? 180;
  const lengths = r.pooled ? (r.policy?.durations ?? []) : null;
  const lengthAt = lengths ? lengths.indexOf(shownDuration) : -1;
  const shorter = lengths ? (lengthAt > 0 ? lengths[lengthAt - 1]! : null) : shownDuration - step >= minDuration ? shownDuration - step : null;
  const longer = lengths ? (lengthAt >= 0 && lengthAt < lengths.length - 1 ? lengths[lengthAt + 1]! : null) : shownDuration + step <= maxDuration ? shownDuration + step : null;
  const thing = (r.category?.unitLabel ?? 'unit').toLowerCase();
  // Pooled: how many are free at the picked start, and the total for the number chosen (the prices on the page are for one).
  const slotAt = selected ? r.availableStartTimes.indexOf(selected) : -1;
  const left = r.pooled && slotAt >= 0 ? (r.pooled.remaining[slotAt] ?? 1) : 1;
  const qty = r.pooled ? Math.max(1, Math.min(quantity, left)) : 1;
  // While a new day or length is searched the price is unknown, so none is shown rather than a guess.
  const reloading = loading;
  const displayPrice = reloading ? null : r.price;
  const picked = selected ? priceAt(r, selected) : null;
  const offer = offerOf(r);

  return (
    <Screen>
      <article aria-label={`Book ${r.venue.name}`} className="grid gap-6 pb-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
        <div className="min-w-0 space-y-5">
        <Pictures key={r.resource.id} unit={r} venueName={r.venue.name} saved={saved.isSaved(r.venue.id)} onToggleSave={() => void saved.toggle(r.venue.id)} />

        {/* The venue's facilities, each as its first picture with its name on it, right under the big picture of the one picked. */}
        <section aria-label="Facilities at this venue">
          <h2 className="sr-only">Facilities at this venue</h2>
          <div role="tablist" aria-label={`${r.venue.name} facilities`} className="scrollbar-hide -m-1 flex gap-2.5 overflow-x-auto p-1">
            {units.map((u) => {
              const on = u.resource.id === r.resource.id;
              const photo = u.resource.photoUrls?.[0] ?? u.venue.photoUrl;
              const label = u.resource.groundType ? `${u.resource.name} · ${u.resource.groundType}` : u.resource.name;
              return (
                <button
                  key={u.resource.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => go({ resource: u.resource.id })}
                  className={`relative h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-stone-100 to-stone-300 text-left outline-none transition focus-visible:ring-4 focus-visible:ring-brand-600/30 sm:h-28 sm:w-48 ${on ? 'ring-[3px] ring-brand-700 ring-offset-2 ring-offset-gray-50' : 'opacity-90 hover:opacity-100'}`}
                >
                  {photo ? (
                    <img src={photo} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-9 top-0 flex items-center justify-center">
                      <CategoryIcon iconKey={u.category?.iconKey ?? 'category'} iconSvg={u.category?.iconSvg} className="text-[2.5rem] text-stone-500/70" />
                    </span>
                  )}
                  {photo && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/75 to-transparent" />}
                  <span className="absolute inset-x-0 bottom-0 px-2.5 pb-2">
                    <span className={`block truncate text-sm font-extrabold leading-tight ${photo ? 'text-white' : 'text-slate-900'}`}>{label}</span>
                    <span className={`block text-xs font-semibold ${photo ? 'text-white/85' : 'text-slate-600'}`}>
                      {u.availableStartTimes.length === 0 ? 'No slots left' : u.price ? formatPrice(u.price) : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <header>
          <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-brand-700">Book your slot</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{r.venue.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Icon name="location_on" className="text-[1rem] text-slate-400" />
            {r.venue.address}
          </p>
          {about && <p className="mt-3 max-w-2xl whitespace-pre-line text-pretty text-sm leading-relaxed text-slate-600">{about}</p>}
        </header>

        </div>

        <div className="min-w-0 space-y-5 lg:sticky lg:top-24">
        <section aria-label="Pick a day" className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1">
          {days.map((d) => {
            const active = d.iso === dateIso;
            return (
              <button
                key={d.iso}
                type="button"
                aria-pressed={active}
                onClick={() => go({ date: d.iso })}
                className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border transition active:scale-95 ${active ? 'border-brand-700 bg-brand-700 text-white shadow-glow' : 'border-slate-200 bg-white text-slate-900 hover:border-brand-400'}`}
              >
                <span className={`text-[0.6875rem] ${active ? 'font-bold' : 'font-medium text-slate-500'}`}>{d.weekday}</span>
                <span className="text-lg font-extrabold leading-tight">{d.day}</span>
                <span className={`text-[0.6875rem] ${active ? 'text-brand-100' : 'font-medium text-slate-500'}`}>{d.month}</span>
              </button>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">{formatDateLabel(dateIso)}</span>
            <span className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
              {r.resource.groundType ? `${r.resource.name} · ${r.resource.groundType}` : r.resource.name}
            </span>
            {!r.pooled?.slots && (
            <span className="inline-flex items-center gap-1 rounded-md bg-white py-0.5 pl-1 pr-2 font-bold text-slate-700 ring-1 ring-slate-200">
              <button
                type="button"
                aria-label="Shorter booking"
                disabled={shorter === null}
                onClick={() => {
                  if (shorter === null) return;
                  setDurationMinutes(shorter);
                  go({ duration: shorter });
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-16 px-1 text-center">{durationLabel(shownDuration)}</span>
              <button
                type="button"
                aria-label="Longer booking"
                disabled={longer === null}
                onClick={() => {
                  if (longer === null) return;
                  setDurationMinutes(longer);
                  go({ duration: longer });
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </span>
            )}
          </div>

          <div className={`p-5 transition-opacity ${reloading ? 'pointer-events-none opacity-50' : ''}`}>
            {!reloading && offer && (
              <p className="mb-3 flex flex-wrap items-center gap-2 text-sm font-bold text-rose-700">
                <OfferTag offer={offer} />
                {offer.slots === r.availableStartTimes.length ? 'Offer on every slot today' : `Offer on ${offer.slots} of ${r.availableStartTimes.length} slots`}
              </p>
            )}
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
              {reloading ? 'Updating slots…' : r.availableStartTimes.length === 0 ? 'No slots left for this day' : `${r.availableStartTimes.length} slot${r.availableStartTimes.length === 1 ? '' : 's'} available — tap to select`}
            </p>
            <div className={r.pooled?.slots ? 'grid grid-cols-1 gap-2 sm:grid-cols-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4'}>
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
                      active ? 'border-brand-600 bg-brand-600 text-white shadow-md' : 'border-slate-200 bg-white text-slate-800 hover:border-brand-400 hover:bg-brand-50/50'
                    }`}
                  >
                    <span className="flex flex-col leading-tight">
                      <span className={`whitespace-nowrap text-sm font-extrabold ${active ? 'text-white' : 'text-slate-900'}`}>
                        {r.pooled?.slots ? `${formatStart(t, r.timezone)} – ${formatStart(r.pooled.slots[r.availableStartTimes.indexOf(t)]?.endTime ?? t, r.timezone)}` : formatStart(t, r.timezone)}
                      </span>
                      {r.pooled && <span className={`text-[0.625rem] font-semibold ${active ? 'text-white/80' : 'text-slate-500'}`}>{r.pooled.remaining[r.availableStartTimes.indexOf(t)] ?? 0} left</span>}
                    </span>
                    {slotPrice && (
                      <span className="flex shrink-0 flex-col items-end leading-tight">
                        <span className={`text-[0.6875rem] font-black ${active ? 'text-brand-100' : 'text-brand-700'}`}>{formatPrice(slotPrice)}</span>
                        {slotPrice.normalAmount && (
                          <s className={`text-[0.625rem] font-medium ${active ? 'text-white/70' : 'text-slate-400'}`}>{formatPrice({ amount: slotPrice.normalAmount, currency: slotPrice.currency })}</s>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 bg-white p-4">
            {selected && r.pooled && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                <span className="text-sm font-bold text-slate-800">
                  How many {thing}s
                  <span className="ml-2 text-xs font-semibold text-slate-500">{left} left</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-white py-0.5 pl-1 pr-2 font-bold text-slate-700 ring-1 ring-slate-200">
                  <button type="button" aria-label={`Fewer ${thing}s`} disabled={qty <= 1} onClick={() => setQuantity(qty - 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40">
                    −
                  </button>
                  <span aria-live="polite" className="min-w-8 px-1 text-center">{qty}</span>
                  <button type="button" aria-label={`More ${thing}s`} disabled={qty >= left} onClick={() => setQuantity(qty + 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40">
                    +
                  </button>
                </span>
              </div>
            )}
            {selected && (
              <p className="mb-2 text-center text-xs font-semibold text-slate-600">
                {formatDateLabel(dateIso)} · {formatTimeRange(selected, holdLength, r.timezone)} · {displayPrice && picked ? formatPrice(totalOf(picked, qty)) : ''}
                {r.pooled && qty > 1 && displayPrice && picked && <span className="text-slate-400"> ({formatPrice(picked)} each × {qty})</span>}
                {displayPrice && picked?.normalAmount && <s className="ml-1 font-medium text-slate-400">{formatPrice({ amount: String(Number(picked.normalAmount) * qty), currency: r.price!.currency })}</s>}
                {displayPrice && picked && payNowLabel(totalOf(picked, qty)) && <span className="block text-brand-700">{payNowLabel(totalOf(picked, qty))}, the rest at the venue</span>}
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
              onClick={() => selected && bookSlot(selected, qty)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-extrabold text-white shadow-glow transition hover:bg-brand-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:active:scale-100"
            >
              {booking && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {booking ? 'Holding your slot…' : selected ? `Book ${formatStart(selected, r.timezone)}${r.pooled ? ` · ${qty} ${thing}${qty === 1 ? '' : 's'}` : ''}` : 'Select a slot above'}
            </button>
          </div>
        </section>
        </div>
      </article>
    </Screen>
  );
}

export default function BookPage() {
  return (
    <Suspense fallback={<Screen><DetailSkeleton /></Screen>}>
      <BookingPage />
    </Suspense>
  );
}
