'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { durationLabel } from '@/lib/categories';
import {
  formatDateLabel,
  formatPrice,
  formatStart,
  formatTimeRange,
  googleMapsLink,
  localIso,
  payNowLabel,
  priceAt,
  todayIso,
  useBookSlot,
  type SearchResult,
} from '@/lib/booking';
import { CategoryIcon, ErrorBanner, Icon } from '@/components/ui';
import { DetailSkeleton } from '@/components/skeleton';
import { BackButton } from '@/components/back-button';
import { BrowseHeader } from '@/components/browse-header';

/** The page's frame: the same header as the listing (logo, place, search, venue types, account), then a back button and the content. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <BrowseHeader />
      <main className="w-full px-4 pb-10 pt-4 sm:px-6 lg:px-10 2xl:px-14">
        <div className="mb-4">
          <BackButton />
        </div>
        {children}
      </main>
    </div>
  );
}

const MOST_DAYS = 14;

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
function Pictures({ unit, venueName }: { unit: SearchResult; venueName: string }) {
  const photos = useMemo(() => {
    const own = unit.resource.photoUrls ?? [];
    return [...own, ...(unit.venue.photoUrl && !own.includes(unit.venue.photoUrl) ? [unit.venue.photoUrl] : [])];
  }, [unit]);
  const [index, setIndex] = useState(0);
  const shown = photos[Math.min(index, photos.length - 1)];
  return (
    <div>
      <div className="relative aspect-[16/9] overflow-hidden rounded-xl bg-stone-200 sm:aspect-[16/7]">
        {shown ? (
          <img key={shown} src={shown} alt={`${venueName}, ${unit.resource.name}`} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-stone-100 via-stone-200 to-stone-300">
            <CategoryIcon iconKey={unit.category?.iconKey ?? 'category'} iconSvg={unit.category?.iconSvg} className="text-[6rem] text-stone-500/70" />
          </div>
        )}
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
  const router = useRouter();
  const params = useParams<{ facilityCode: string; resourceId: string }>();
  const query = useSearchParams();
  const facilityCode = decodeURIComponent(params.facilityCode);
  const resourceId = decodeURIComponent(params.resourceId);
  const dateParam = query.get('date');
  const dateIso = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso();
  const durationParam = Number(query.get('duration'));
  const [durationMinutes, setDurationMinutes] = useState<number | null>(Number.isFinite(durationParam) && durationParam > 0 ? durationParam : null);

  const [units, setUnits] = useState<SearchResult[] | null>(null);
  const [dayCount, setDayCount] = useState(MOST_DAYS);
  const [about, setAbout] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const latest = useRef(0);

  const go = (next: { resource?: string; date?: string; duration?: number | null }) => {
    const rid = next.resource ?? resourceId;
    const date = next.date ?? dateIso;
    const duration = next.duration === undefined ? durationMinutes : next.duration;
    router.replace(`/book/${encodeURIComponent(facilityCode)}/${encodeURIComponent(rid)}?date=${date}${duration ? `&duration=${duration}` : ''}`, { scroll: false });
  };

  // The venue's units for that day; only the newest answer may land (a new day or length searches again).
  useEffect(() => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    const search = new URLSearchParams({ facilityCode, date: dateIso, timeWindow: 'ALL', ...(durationMinutes ? { durationMinutes: String(durationMinutes) } : {}) });
    api
      .getPage<SearchResult[]>(`/search?${search.toString()}`)
      .then((page) => {
        if (mine !== latest.current) return;
        if (page.data.length === 0) setError('This venue is not available to book any more.');
        else setUnits(page.data);
        if (page.advanceDays) setDayCount(Math.min(MOST_DAYS, Math.max(1, page.advanceDays)));
      })
      .catch((err) => mine === latest.current && setError(err instanceof ApiError ? err.message : 'Could not load this venue.'))
      .finally(() => mine === latest.current && setLoading(false));
  }, [facilityCode, dateIso, durationMinutes]);

  // The venue's description, when it has one (the page works without it).
  useEffect(() => {
    api
      .get<{ description?: string | null }>(`/venues/by-code/${encodeURIComponent(facilityCode)}`)
      .then((v) => setAbout(v.description?.trim() || null))
      .catch(() => undefined);
  }, [facilityCode]);

  const unit = units?.find((u) => u.resource.id === resourceId) ?? units?.[0];

  // A different unit, day or length makes the picked start time stale.
  useEffect(() => setSelected(null), [unit?.resource.id, dateIso, durationMinutes]);

  const shownDuration = unit?.durationMinutes ?? durationMinutes ?? unit?.policy?.minDurationMin ?? 60;
  const { bookSlot, busyStart, error: bookError, clearError } = useBookSlot(unit?.resource.id ?? resourceId, shownDuration);
  const booking = busyStart !== null;
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
  const step = r.policy?.durationIncrementMin ?? 60;
  const minDuration = r.policy?.minDurationMin ?? 60;
  const maxDuration = r.policy?.maxDurationMin ?? 180;
  // While a new day or length is searched the price is unknown, so none is shown rather than a guess.
  const reloading = loading;
  const displayPrice = reloading ? null : r.price;
  const picked = selected ? priceAt(r, selected) : null;

  return (
    <Screen>
      <article aria-label={`Book ${r.venue.name}`} className="grid gap-6 pb-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
        <div className="min-w-0 space-y-5">
        <Pictures key={r.resource.id} unit={r} venueName={r.venue.name} />

        <header>
          <p className="text-[0.625rem] font-extrabold uppercase tracking-wider text-brand-700">Book your slot</p>
          <h1 className="mt-0.5 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{r.venue.name}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Icon name="location_on" className="text-[1rem] text-slate-400" />
            {r.venue.address}
          </p>
          {about && <p className="mt-3 max-w-2xl whitespace-pre-line text-pretty text-sm leading-relaxed text-slate-600">{about}</p>}
          <a
            href={googleMapsLink(r.venue)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-brand-500/30 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 transition hover:bg-brand-100 active:scale-95"
          >
            <Icon name="navigation" className="text-[0.875rem]" />
            Directions
          </a>
        </header>

        <section aria-label="Facilities at this venue">
          <h2 className="mb-2 text-sm font-extrabold text-slate-900">Facilities at this venue</h2>
          <div role="tablist" aria-label={`${r.venue.name} facilities`} className="scrollbar-hide -m-0.5 flex gap-2 overflow-x-auto p-0.5">
            {units.map((u) => {
              const on = u.resource.id === r.resource.id;
              return (
                <button
                  key={u.resource.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => go({ resource: u.resource.id })}
                  className={`flex w-44 shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${on ? 'border-brand-700 bg-brand-700 text-white shadow-glow' : 'border-slate-200 bg-white text-slate-800 hover:border-brand-400'}`}
                >
                  <CategoryIcon iconKey={u.category?.iconKey ?? 'category'} iconSvg={u.category?.iconSvg} className={`text-[1.25rem] ${on ? 'text-white' : 'text-slate-500'}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold leading-tight">{u.resource.groundType ? `${u.resource.name} · ${u.resource.groundType}` : u.resource.name}</span>
                    {u.availableStartTimes.length === 0 ? (
                      <span className={`block text-xs font-semibold ${on ? 'text-white/80' : 'text-slate-400'}`}>No slots left</span>
                    ) : (
                      u.price && <span className={`block text-xs font-semibold ${on ? 'text-brand-100' : 'text-brand-700'}`}>{formatPrice(u.price)}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
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
            <span className="inline-flex items-center gap-1 rounded-md bg-white py-0.5 pl-1 pr-2 font-bold text-slate-700 ring-1 ring-slate-200">
              <button
                type="button"
                aria-label="Shorter booking"
                disabled={shownDuration - step < minDuration}
                onClick={() => {
                  setDurationMinutes(shownDuration - step);
                  go({ duration: shownDuration - step });
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-16 px-1 text-center">{durationLabel(shownDuration)}</span>
              <button
                type="button"
                aria-label="Longer booking"
                disabled={shownDuration + step > maxDuration}
                onClick={() => {
                  setDurationMinutes(shownDuration + step);
                  go({ duration: shownDuration + step });
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700 transition hover:bg-slate-200 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </span>
          </div>

          <div className={`p-5 transition-opacity ${reloading ? 'pointer-events-none opacity-50' : ''}`}>
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">
              {reloading ? 'Updating slots…' : r.availableStartTimes.length === 0 ? 'No slots left for this day' : `${r.availableStartTimes.length} slot${r.availableStartTimes.length === 1 ? '' : 's'} available — tap to select`}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4">
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
                    <span className={`text-sm font-extrabold ${active ? 'text-white' : 'text-slate-900'}`}>{formatStart(t, r.timezone)}</span>
                    {slotPrice && <span className={`shrink-0 text-[0.6875rem] font-black ${active ? 'text-brand-100' : 'text-brand-700'}`}>{formatPrice(slotPrice)}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 bg-white p-4">
            {selected && (
              <p className="mb-2 text-center text-xs font-semibold text-slate-600">
                {formatDateLabel(dateIso)} · {formatTimeRange(selected, shownDuration, r.timezone)} · {displayPrice && picked ? formatPrice(picked) : ''}
                {displayPrice && picked?.normalAmount && <s className="ml-1 font-medium text-slate-400">{formatPrice({ amount: picked.normalAmount, currency: r.price!.currency })}</s>}
                {displayPrice && picked && payNowLabel(picked) && <span className="block text-brand-700">{payNowLabel(picked)}, the rest at the venue</span>}
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-5 py-3 text-sm font-extrabold text-white shadow-glow transition hover:bg-brand-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none disabled:active:scale-100"
            >
              {booking && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
              {booking ? 'Holding your slot…' : selected ? `Book ${formatStart(selected, r.timezone)}` : 'Select a slot above'}
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
