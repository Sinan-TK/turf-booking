'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useDebounced } from '@/lib/use-debounced';
import { trustedMapsUrl } from '@/lib/maps';
import { useSavedVenues } from '@/lib/saved-venues';
import { CategoryIcon, ErrorBanner, Icon } from '@/components/ui';
import { LoadingNote, Skeleton, VenueCardSkeleton, VenueCardsSkeleton } from '@/components/skeleton';
import { AccountMenu } from '@/components/account-menu';
import { LocationPicker } from '@/components/location-picker';
import { VenueTypePicker } from '@/components/venue-type-picker';
import { RotatingTypeIcon } from '@/components/rotating-type-icon';
import { readSearch, writeSearch } from '@/lib/search-cache';
import { locationParams, useLocationChoice, type LocationChoice } from '@/lib/location';
import { durationLabel, type VenueCategory } from '@/lib/categories';
import { OfferTag, bookingHref, formatPrice, formatStart, googleMapsLink, localIso, offerOf, priceAt, todayIso, useBookSlot, type SearchResult, type SlotPrice } from '@/lib/booking';

/** The header's place name on one line: "Malappuram, Kerala", "Kottakkal, Malappuram" or "Near Tirur". */
function placeLabel(choice: LocationChoice | null): string {
  if (!choice) return 'Select location';
  if (choice.mode === 'town') return `${choice.townName ?? choice.districtName}, ${choice.districtName}`;
  if (choice.mode === 'geo') return choice.nearTown ? `Near ${choice.nearTown}` : 'Your location';
  return choice.stateName ? `${choice.districtName}, ${choice.stateName}` : choice.districtName;
}

const DEFAULT_DAY_COUNT = 14;
const MOST_DAYS = 14;

/** The next `count` calendar days (today first), for the 1-tap date strip. */
function nextDays(count: number): Array<{ iso: string; weekday: string; day: string; month: string; isToday: boolean }> {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: localIso(d),
      weekday: i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' }),
      day: String(d.getDate()),
      month: d.toLocaleDateString([], { month: 'short' }),
      isToday: i === 0,
    };
  });
}

export default function ExplorePage() {
  // Where to search: the saved choice, otherwise Malappuram. Nothing is searched until that is known.
  const { choice, setChoice, ready } = useLocationChoice();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);

  // The header gains a soft shadow once the page has scrolled a little.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // "/" jumps to the search box, unless the person is already typing somewhere.
  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      e.preventDefault();
      searchBox.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // The customer's saved venues, for the save buttons on the cards. Saving needs an account: logged out, a tap opens the login.
  const saved = useSavedVenues();

  const [form, setForm] = useState({
    // The venue types searched; empty = every type. The chips pick one, the venue-type modal (wide screens) several.
    categorySlugs: [] as string[],
    groundType: '',
    date: todayIso(),
    timeWindow: 'ALL',
    // null = every unit at its own shortest booking; a length picked inside a booking window applies to the units that offer it.
    durationMinutes: null as number | null,
  });

  const [nameFilter, setNameFilter] = useState('');
  // Links such as /explore?q=Venue+name (the "View slots" button of a saved venue) and /explore?type=FOOTBALL_TURF (the landing page's
  // venue types) start with that search typed in or that venue type picked.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) setNameFilter(q);
    const types = (params.get('type') ?? '').split(',').filter(Boolean);
    if (types.length > 0) setForm((f) => ({ ...f, categorySlugs: types }));
  }, []);
  // The text filter is applied by the server (so it covers venues not loaded yet), once typing pauses.
  const searchText = useDebounced(nameFilter.trim(), 350);

  // Active venue types (Super-Admin managed) drive the filter chips.
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  // The facilities' pictures start downloading as soon as the list is known, so the venue-type picker has them by the time it opens.
  useEffect(() => {
    for (const c of categories) if (c.imageUrl) new Image().src = c.imageUrl;
  }, [categories]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  // The day the shown results are for. While another day loads, the cards keep drawing their own day, not the new one.
  const [resultsDate, setResultsDate] = useState(todayIso());
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
        ...(form.durationMinutes !== null ? { durationMinutes: String(form.durationMinutes) } : {}),
        limit: String(!cursor && keepLoaded.current ? Math.min(50, Math.max(PAGE_SIZE, loadedCount.current)) : PAGE_SIZE),
        ...locationParams(choice!),
      });
      // Both filters are optional: no category = every venue type, no sub-type = every kind of unit. The API owns the filtering.
      if (form.categorySlugs.length > 0) params.set('categorySlugs', form.categorySlugs.join(','));
      if (form.groundType) params.set('groundType', form.groundType);
      if (searchText) params.set('q', searchText);
      if (cursor) params.set('cursor', cursor);
      return `/search?${params.toString()}`;
    },
    [choice, form.categorySlugs, form.groundType, form.date, form.timeWindow, form.durationMinutes, searchText],
  );

  /** A new search: the first ten cards. Anything still loading from an earlier search is ignored from now on. */
  const runSearch = useCallback(async () => {
    if (!choice) return;
    const mine = ++latestSearch.current;
    const date = form.date;
    // A new day, place, type or text: the old cards go at once and the skeleton shows until the new ones arrive.
    // A duration change made inside an open booking window keeps the cards, so that window stays open.
    const path = searchPath();
    // A repeat of a recent search paints its saved cards at once (the live answer replaces them a moment later, and the slim
    // "checking live availability" bar shows meanwhile). Otherwise the skeleton shows until the cards arrive.
    const saved = keepLoaded.current ? null : readSearch<SearchResult>(path);
    if (!keepLoaded.current) {
      setResults(saved ? saved.data : []);
      setNextCursor(saved ? saved.nextCursor : null);
      if (saved) {
        setResultsDate(date);
        setSearched(true);
      }
    }
    setSearching(true);
    setLoadingMore(false);
    setMoreError(null);
    setErrorMessage(null);
    try {
      const page = await api.getPage<SearchResult[]>(path);
      keepLoaded.current = false;
      if (mine !== latestSearch.current) return;
      writeSearch<SearchResult>(path, { data: page.data, nextCursor: page.nextCursor, advanceDays: page.advanceDays ?? null });
      setResults(page.data);
      setResultsDate(date);
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
  }, [choice, searchPath, form.date]);

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
  const venueGroups = useMemo(() => groupByVenue(visibleResults), [visibleResults]);

  // Sub-types (and a type's own shortest booking) only make sense when exactly one type is picked.
  const activeCategory = form.categorySlugs.length === 1 ? categories.find((c) => c.slug === form.categorySlugs[0]) : undefined;

  function selectCategories(slugs: string[]) {
      setForm((f) => ({
      ...f,
      categorySlugs: slugs,
      groundType: '',
      // A new type starts every unit at its own shortest booking again.
      durationMinutes: null,
    }));
  }

  // The days depend on today's date, which the server cannot know: the page is built ahead of time (and the server may
  // be in another timezone), so server-made dates would be stale and never match what the browser makes. The day row is
  // therefore drawn only once the page is in the browser, with same-sized grey boxes until then.
  const [inBrowser, setInBrowser] = useState(false);
  useEffect(() => setInBrowser(true), []);
  const days = useMemo(() => nextDays(dayCount), [dayCount]);
  // When none of the cards on screen has a picture (they all show the stone placeholder), the chosen day takes that stone colour too.
  const noPhotos = results.length > 0 && results.every((r) => !(r.resource.photoUrls?.length ?? 0) && !r.venue.photoUrl);

  const locationLabel = placeLabel(choice);


  return (
    <>
      {/* Header: a plain white bar. Logo · location · search · venue types, with the account on the right; below md the
          search wraps to its own row. It gains a soft shadow once the page scrolls. */}
      <header
        className={`sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-md transition-shadow duration-300 ${scrolled ? 'shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)]' : ''}`}
      >
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 sm:px-6 md:flex-nowrap md:gap-x-4 lg:px-10 2xl:px-14">
          <Link href="/" aria-label="TurfX home" className="mr-2 hidden select-none whitespace-nowrap text-[1.75rem] font-black italic leading-none tracking-tight text-slate-900 lg:block">
            Turf<span className="text-brand-600">X</span>
          </Link>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            aria-label={`Change location, now ${locationLabel}`}
            aria-haspopup="dialog"
            className="group flex h-11 min-w-0 max-w-[65%] items-center gap-1.5 px-1 text-left transition active:opacity-70 md:h-12 md:w-auto md:max-w-[16rem] md:shrink-0"
          >
            <Icon name="location_on" className="text-[1.125rem] text-brand-600" />
            <span className="min-w-0 truncate text-sm font-bold text-slate-900 underline decoration-transparent decoration-2 underline-offset-4 transition group-hover:decoration-brand-600">{locationLabel}</span>
            <Icon name="expand_more" className="text-[1rem] text-slate-400 transition group-hover:text-brand-600" />
          </button>
          <div className="ml-auto md:order-last">
            <AccountMenu />
          </div>
          <div className={`nav-search order-last flex h-11 w-full items-center overflow-hidden rounded-xl border bg-slate-50/70 px-3.5 transition-[box-shadow,border-color,background-color] [&:has(input:focus)]:border-brand-500 [&:has(input:focus)]:bg-white md:order-none md:h-12 md:w-auto md:max-w-3xl md:flex-1 ${form.categorySlugs.length > 0 ? 'border-brand-600' : 'border-slate-200 hover:border-slate-300'}`}>
            <Icon name="search" className="text-[1.125rem] text-slate-500" />
            <input
              ref={searchBox}
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              aria-label="Search venues"
              className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-medium text-slate-800 placeholder-slate-400 focus:outline-none"
              placeholder="Search venues, turfs, pools, badminton, activities..."
              type="text"
            />
            {nameFilter && (
              <button
                type="button"
                onClick={() => {
                  setNameFilter('');
                  searchBox.current?.focus();
                }}
                aria-label="Clear search"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700"
              >
                <Icon name="close" className="text-[0.9375rem]" />
              </button>
            )}
            {/* Pick several venue types at once, as part of the same bar (the word is left off on phones to save room). */}
            <button
              type="button"
              onClick={() => setTypePickerOpen(true)}
              aria-label={form.categorySlugs.length > 0 ? `Venue types, ${form.categorySlugs.length} selected` : "Venue types"}
              aria-haspopup="dialog"
              className={`-mr-3.5 ml-1 inline-flex h-full flex-shrink-0 items-center gap-1.5 border-l px-3 text-sm font-bold transition sm:gap-2 sm:px-4 ${form.categorySlugs.length > 0 ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 bg-transparent text-slate-700 hover:bg-slate-100'}`}
            >
              <RotatingTypeIcon types={categories} className={`text-[1.375rem] ${form.categorySlugs.length > 0 ? "text-brand-800" : "text-brand-600"}`} />
              <span className="hidden sm:inline">Venue types</span>
              {form.categorySlugs.length > 0 && (
                <span className="rounded-md bg-brand-700 px-1.5 text-[0.6875rem] leading-[1.125rem] text-white">{form.categorySlugs.length}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Every bookable day in one row (it swipes sideways when it does not fit). */}
      <section className="flex w-full flex-col gap-3 px-4 pb-4 pt-4 sm:px-6 lg:px-10 2xl:px-14">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto scroll-smooth scrollbar-hide sm:gap-2.5">
          {!inBrowser &&
            Array.from({ length: DEFAULT_DAY_COUNT }, (_, i) => (
              <Skeleton key={i} className="h-[4.5rem] w-[4.25rem] flex-shrink-0 rounded-xl sm:h-[4.75rem] sm:w-[5.25rem] lg:w-auto lg:min-w-[3.75rem] lg:max-w-[5.25rem] lg:flex-1" />
            ))}
          {inBrowser && days.map((d) => {
            const isActive = form.date === d.iso;
            return (
              <button
                key={d.iso}
                type="button"
                aria-pressed={isActive}
                onClick={() => setForm((f) => ({ ...f, date: d.iso }))}
                className={`flex h-[4.5rem] w-[4.25rem] flex-shrink-0 flex-col items-center justify-center rounded-xl border transition active:scale-95 sm:h-[4.75rem] sm:w-[5.25rem] lg:w-auto lg:min-w-[3.75rem] lg:max-w-[5.25rem] lg:flex-1 ${isActive ? (noPhotos ? 'border-stone-400 bg-stone-300 text-stone-900 shadow-sm' : 'border-brand-700 bg-brand-700 text-white shadow-glow') : 'border-slate-200 bg-white text-slate-900 hover:border-brand-400'}`}
              >
                <span className={`text-xs ${isActive ? (noPhotos ? 'font-bold text-stone-900' : 'font-bold text-white') : 'font-medium text-slate-500'}`}>{d.weekday}</span>
                <span className="text-xl font-extrabold leading-tight">{d.day}</span>
                <span className={`text-xs ${isActive ? (noPhotos ? 'font-semibold text-stone-700' : 'font-semibold text-brand-100') : 'font-medium text-slate-500'}`}>{d.month}</span>
              </button>
            );
          })}
        </div>
      </section>
      {activeCategory && activeCategory.unitTypes.length > 0 && (
        <div className="-mt-1 flex w-full items-center gap-2 overflow-x-auto px-4 pb-4 scrollbar-hide sm:px-6 lg:px-10 2xl:px-14">
          {[{ value: '', label: `Any ${activeCategory.unitLabel.toLowerCase()}` }, ...activeCategory.unitTypes.map((t) => ({ value: t, label: t }))].map((t) => {
            const isActive = form.groundType === t.value;
            return (
              <button
                key={t.value || 'any'}
                type="button"
                onClick={() => setForm((f) => ({ ...f, groundType: t.value }))}
                aria-pressed={isActive}
                className={`flex-shrink-0 rounded-md border px-3 py-1 text-[0.6875rem] font-bold transition ${isActive ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-400'}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      <main className="relative w-full flex-1 px-4 pb-24 sm:px-6 lg:px-10 2xl:px-14">
        {errorMessage && <div className="mb-4"><ErrorBanner message={errorMessage} /></div>}
        {/* Every new search shows the skeleton in place of the cards. */}
        {searching && results.length === 0 && <VenueCardsSkeleton count={6} />}
        {/* Cards already on screen (saved ones, or a length change) stay as they are while the live answer loads: nothing is drawn between the dates and the cards. */}
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
                  className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700"
                >
                  Browse all of {choice.districtName}
                </button>
              </>
            ) : (
              'Nothing available for that search. Try a different time, date, type, or location.'
            )}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {venueGroups.map((group) => (
            <VenueGroupCard
              key={group.venue.id}
              venue={group.venue}
              units={group.units}
              // The modals edit the duration, which re-searches: look each unit up in the live results so an open
              // modal refreshes its slots and prices instead of going stale.
              liveFor={(r) => results.find((x) => x.venue.id === r.venue.id && x.resource.id === r.resource.id) ?? r}
              saved={saved.isSaved(group.venue.id)}
              onToggleSave={() => void saved.toggle(group.venue.id)}
              durationMinutes={form.durationMinutes}
              dateIso={resultsDate}
              reloading={searching}
              onDurationChange={(m: number) => {
                keepLoaded.current = true;
                setForm((f) => ({ ...f, durationMinutes: m }));
              }}
            />
          ))}
          {/* The next venues load into the same grid: skeletons fill the rest of the last row first. */}
          {loadingMore && (
            <>
              <LoadingNote label="Loading the next venues" />
              {Array.from({ length: skeletonsToFillRow(venueGroups.length) }, (_, i) => (
                <VenueCardSkeleton key={`more-${i}`} />
              ))}
            </>
          )}
        </div>

        {visibleResults.length > 0 && (
          <>
            {moreError && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <ErrorBanner message={moreError} />
                <button type="button" onClick={() => void loadMore()} className="rounded-md bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700">
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
      {typePickerOpen && (
        <VenueTypePicker
          categories={categories}
          selected={form.categorySlugs}
          onApply={(slugs) => {
            selectCategories(slugs);
            setTypePickerOpen(false);
          }}
          onClose={() => setTypePickerOpen(false)}
        />
      )}
    </>
  );
}

/** What a venue's card is told about each of its units: the live result (it refreshes while a modal is open) and the one shown. */
interface UnitCardProps {
  result: SearchResult;
  liveResult: SearchResult;
  /** The length asked for, or null when each unit is shown at its own shortest. A unit's result says what it used. */
  durationMinutes: number | null;
  dateIso: string;
  reloading: boolean;
  onDurationChange: (minutes: number) => void;
}

/**
 * How many skeleton cards to add while the next venues load, so they finish the last row in every layout (one, two or
 * three columns: 6 is a multiple of each). When the last row is already full, one more row's worth.
 */
function skeletonsToFillRow(cards: number): number {
  return (6 - (cards % 6)) % 6 || 3;
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
 * One card per venue: a photo banner (the picked unit's photos, else the venue's, else a drawn placeholder), the
 * venue's name, address and Directions, a row of unit tiles (turf, court…) to pick from, and the picked unit's next
 * open times and Book Now.
 */
function VenueGroupCard({
  venue,
  units,
  liveFor,
  saved,
  onToggleSave,
  ...unitProps
}: {
  venue: SearchResult['venue'];
  units: SearchResult[];
  liveFor: (r: SearchResult) => SearchResult;
  saved: boolean;
  onToggleSave: () => void;
} & Omit<UnitCardProps, 'result' | 'liveResult'>) {
  const [pickedId, setPickedId] = useState(units[0]!.resource.id);
  // A re-search can drop the picked unit (a filter, a new day): fall back to the first one.
  const unit = units.find((u) => u.resource.id === pickedId) ?? units[0]!;
  const openSlots = units.reduce((n, u) => n + u.availableStartTimes.length, 0);
  // Everything is taken, or the day's time has passed: the card stays in the list but greyed out.
  const soldOut = openSlots === 0;
  const unitPhotos = unit.resource.photoUrls ?? [];
  const photos = unitPhotos.length > 0 ? unitPhotos : venue.photoUrl ? [venue.photoUrl] : [];

  return (
    <article
      aria-label={venue.name}
      data-sold-out={soldOut ? 'true' : undefined}
      className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm transition-shadow duration-300 hover:shadow-lg ${soldOut ? 'opacity-70 grayscale' : ''}`}
    >
      <CardGallery
        key={unit.resource.id}
        photos={photos}
        iconKey={unit.category?.iconKey ?? 'category'}
        iconSvg={unit.category?.iconSvg}
        alt={`${venue.name}, ${unit.resource.name}`}
        offer={offerOf(unit)}
        badge={soldOut ? 'No slots left' : `${openSlots} slot${openSlots === 1 ? '' : 's'} open`}
        saved={saved}
        onToggleSave={onToggleSave}
        venueName={venue.name}
      />

      <div className="flex flex-1 flex-col gap-3.5 px-3.5 pb-3.5 pt-3 sm:px-4 sm:pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold leading-snug tracking-tight text-slate-900">{venue.name}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-slate-500">
              <Icon name="location_on" className="text-[0.9375rem] text-slate-400" />
              <span className="truncate">{venue.address}</span>
            </p>
          </div>
          <a
            href={googleMapsLink(venue)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-100 active:scale-95"
          >
            <Icon name="navigation" className="text-[0.875rem]" />
            Directions
          </a>
        </div>

        <div role="tablist" aria-label={`${venue.name} options`} className="scrollbar-hide -m-0.5 flex gap-2 overflow-x-auto p-0.5">
          {units.map((u) => {
            const on = u.resource.id === unit.resource.id;
            return (
              <button
                key={u.resource.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setPickedId(u.resource.id)}
                className={`flex w-[8.5rem] shrink-0 items-center sm:w-[calc((100%-1rem)/3)] gap-2 rounded-xl border px-2 py-2.5 text-left transition active:scale-[0.98] ${on ? 'border-brand-700 bg-brand-700 text-white shadow-glow' : 'border-slate-200 bg-white text-slate-800 hover:border-brand-400'}`}
              >
                <CategoryIcon iconKey={u.category?.iconKey ?? 'category'} iconSvg={u.category?.iconSvg} className={`text-[1.125rem] ${on ? 'text-white' : 'text-slate-500'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold leading-tight">{u.resource.name}</span>
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

        <UnitPanel {...unitProps} key={unit.resource.id} result={unit} liveResult={liveFor(unit)} />
      </div>
    </article>
  );
}

/** "6:00 AM – 12:00 AM": the unit's opening hours on the searched day, or null when none are set. */
function openHoursLabel(r: SearchResult): string | null {
  const windows = r.openWindows;
  if (!windows || windows.length === 0) return null;
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const open = Math.min(...windows.map((w) => toMinutes(w.openTime)));
  const close = Math.max(...windows.map((w) => toMinutes(w.closeTime) || 24 * 60));
  const fmt = (minutes: number) => {
    const d = new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60);
    return d.toLocaleTimeString('en-US', d.getMinutes() ? { hour: 'numeric', minute: '2-digit' } : { hour: 'numeric' });
  };
  return `${fmt(open)} – ${fmt(close)}`;
}

/** How long each photo stays before the banner moves to the next on its own. */
const AUTO_PHOTO_MS = 2000;

/**
 * The card's banner: up to three photos that fade from one to the next, on their own and by hand (arrows on hover,
 * swipe on phones, dots to show where you are), a save button, and how many slots are open. Without photos it draws a calm green field with
 * the unit's icon, so a venue that has not added pictures yet still looks finished.
 */
function CardGallery({
  photos,
  iconKey,
  iconSvg,
  alt,
  offer,
  badge,
  saved,
  onToggleSave,
  venueName,
}: {
  photos: string[];
  iconKey: string;
  iconSvg?: string | null;
  alt: string;
  offer: ReturnType<typeof offerOf>;
  badge: string;
  saved: boolean;
  onToggleSave: () => void;
  venueName: string;
}) {
  const [index, setIndex] = useState(0);
  // Photos that have finished loading (they fade in) and ones the gallery has already shown (kept, so going back is instant).
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => setVisited((v) => (v.has(index) ? v : new Set(v).add(index))), [index]);
  const touchX = useRef<number | null>(null);
  const many = photos.length > 1;
  const go = (step: number) => setIndex((i) => (i + step + photos.length) % photos.length);

  // Photos change on their own every few seconds, but only while someone could be watching: not while the card is
  // pointed at or focused (they are looking or reaching for a button), off screen, in a background tab, or for people
  // who ask for less motion. Each card starts a little later than the last, so a page of cards never flips at once,
  // and a tap on an arrow, a dot or a swipe restarts the wait.
  const banner = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);
  const [watched, setWatched] = useState(false);
  const firstWait = useRef<number | null>(null);
  if (firstWait.current === null) firstWait.current = AUTO_PHOTO_MS + Math.round(Math.random() * 1500);
  useEffect(() => {
    const el = banner.current;
    if (!many || !el) return;
    let onScreen = false;
    const update = () => setWatched(onScreen && document.visibilityState === 'visible');
    const watcher = new IntersectionObserver(([entry]) => {
      onScreen = !!entry?.isIntersecting;
      update();
    }, { threshold: 0.5 });
    watcher.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      watcher.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [many]);
  useEffect(() => {
    if (!many || held || !watched || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const wait = firstWait.current ?? AUTO_PHOTO_MS;
    const timer = setTimeout(() => {
      firstWait.current = AUTO_PHOTO_MS;
      setIndex((i) => (i + 1) % photos.length);
    }, wait);
    return () => clearTimeout(timer);
  }, [index, many, held, watched, photos.length]);

  return (
    <div
      ref={banner}
      className="group relative aspect-[16/7] overflow-hidden bg-stone-200"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (!many || start === null || end === undefined || Math.abs(end - start) < 40) return;
        go(end < start ? 1 : -1);
      }}
    >
      {photos.length > 0 ? (
        photos.map((src, i) =>
          // Only the photo on show is fetched, and the next one once that has arrived: a card with three photos does not pull three.
          i === index || visited.has(i) || (loaded.has(photos[index] ?? '') && i === (index + 1) % photos.length) ? (
            <img
              key={src}
              src={src}
              alt={i === index ? alt : ''}
              aria-hidden={i !== index}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded((l) => (l.has(src) ? l : new Set(l).add(src)))}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${i === index && loaded.has(src) ? 'opacity-100' : 'opacity-0'}`}
            />
          ) : null,
        )
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-stone-100 via-stone-200 to-stone-300">
          {/* Faint centre circle behind the icon. */}
          <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-stone-400/30" />
          <div className="absolute inset-0 flex items-center justify-center">
            <CategoryIcon iconKey={iconKey} iconSvg={iconSvg} className="text-[5.5rem] text-stone-500/70 sm:text-[6.5rem]" />
          </div>
        </div>
      )}
      {/* A soft shade under the badge, only over real photos. */}
      {photos.length > 0 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" />}

      {offer && <OfferTag offer={offer} className="absolute left-2.5 top-2.5" />}

      <button
        type="button"
        onClick={onToggleSave}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${venueName} from saved venues` : `Save ${venueName}`}
        className="absolute right-2.5 top-2.5 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition hover:scale-105 active:scale-95"
      >
        <Icon name="bookmark" className={`text-[1.125rem] ${saved ? 'fill-brand-700 text-brand-700' : 'text-slate-700'}`} />
      </button>

      {many && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2.5 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Icon name="chevron_left" className="text-[1rem]" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2.5 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100 sm:flex"
          >
            <Icon name="chevron_right" className="text-[1rem]" />
          </button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {photos.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Photo ${i + 1} of ${photos.length}`}
                aria-current={i === index}
                className={`h-1.5 rounded-md transition-all ${i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'}`}
              />
            ))}
          </div>
        </>
      )}

      <span className="absolute bottom-2.5 right-2.5 rounded-md bg-white px-2.5 py-1 text-[0.6875rem] font-bold text-brand-700 shadow-sm">{badge}</span>
    </div>
  );
}

/** One hour of a unit's day on its card. */
interface HourCell {
  /** Hour from the start of the venue's day; 24 and above are the small hours after midnight. */
  hour: number;
  state: 'available' | 'booked' | 'unavailable';
  /** The first bookable start inside this hour (what a tap on it books). */
  start: string | null;
}

/** "6 AM", "12 PM", "12 AM" for an hour of the day (24 and above wrap past midnight). */
function shortHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The unit's day as hourly blocks for its card, in the venue's own timezone: available where a booking of the chosen
 * length can start, booked where the venue is open but nothing can start (taken or blocked), unavailable where it is
 * closed or the hour has already gone. The axis runs 6 AM to midnight, widened when the venue opens earlier or later.
 */
function buildDayTimeline(r: SearchResult, dateIso: string): { cells: HourCell[]; first: number; last: number } {
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const windows = (r.openWindows && r.openWindows.length > 0 ? r.openWindows : [{ openTime: '06:00', closeTime: '00:00' }]).map((w) => {
    const open = toMinutes(w.openTime);
    let close = toMinutes(w.closeTime);
    if (close <= open) close += 24 * 60; // closes at or after midnight
    return { open, close };
  });
  const first = Math.min(6, ...windows.map((w) => Math.floor(w.open / 60)));
  const last = Math.min(30, Math.max(24, ...windows.map((w) => Math.ceil(w.close / 60))));

  const zone = r.timezone;
  const parts = (iso: string | Date) => {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
  };
  // Starts after midnight belong to the end of this day's axis.
  const startsByHour = new Map<number, string>();
  for (const t of r.availableStartTimes) {
    const p = parts(t);
    const hour = Math.floor(p.minutes / 60) + (p.day > dateIso ? 24 : 0);
    if (!startsByHour.has(hour)) startsByHour.set(hour, t);
  }
  const now = parts(new Date());
  const nowOnAxis = now.day === dateIso ? now.minutes : now.day > dateIso ? Infinity : -Infinity;

  const cells: HourCell[] = [];
  for (let hour = first; hour < last; hour++) {
    const start = startsByHour.get(hour) ?? null;
    const open = windows.some((w) => hour * 60 < w.close && (hour + 1) * 60 > w.open);
    // An hour that has already begun can only still offer a later start inside it (shown green when it does).
    const past = hour * 60 <= nowOnAxis;
    cells.push({ hour, start, state: start ? 'available' : open && !past ? 'booked' : 'unavailable' });
  }
  return { cells, first, last };
}

const CELL_COLOURS: Record<HourCell['state'], string> = {
  available: 'bg-green-600',
  booked: 'bg-rose-500',
  unavailable: 'bg-slate-200',
};

/**
 * The picked unit's day: the date and opening hours, an hour-by-hour bar (tap a green hour to book it at the chosen
 * length) with its legend, and Book Now for the full booking window (duration, every start time).
 */
function UnitPanel({ result: r, liveResult, durationMinutes: requestedDuration, dateIso }: UnitCardProps) {
  // What this unit's slots and prices are for (its own shortest unless a length it offers was asked for).
  const durationMinutes = liveResult.durationMinutes ?? r.durationMinutes ?? requestedDuration ?? r.policy?.minDurationMin ?? 60;
  const { bookSlot, busyStart, error: bookError } = useBookSlot(r.resource.id, durationMinutes);
  const { cells, first, last } = useMemo(() => buildDayTimeline(r, dateIso), [r, dateIso]);
  const hours = openHoursLabel(r);
  const span = last - first;
  const labels = Array.from({ length: Math.floor(span / 3) + 1 }, (_, i) => first + i * 3).filter((h) => h <= last);

  return (
    <div className="mt-auto flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.9375rem] font-bold text-slate-900">{dayHeading(dateIso)}</span>
        {hours && <span className="text-sm text-slate-500">{hours}</span>}
      </div>

      <div>
        <div aria-hidden="true" className="relative mb-1.5 h-3.5 text-[0.625rem] font-medium text-slate-500">
          {labels.map((h, i) => (
            <span
              key={h}
              className="absolute top-0 whitespace-nowrap"
              style={{ left: `${((h - first) / span) * 100}%`, transform: i === 0 ? 'none' : h === last ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {shortHour(h)}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]" role="group" aria-label={`${r.resource.name}, ${dayHeading(dateIso)}`}>
          {cells.map((c) =>
            c.state === 'available' && c.start ? (
              <button
                key={c.hour}
                type="button"
                disabled={busyStart !== null}
                onClick={() => bookSlot(c.start!)}
                title={`${shortHour(c.hour)} · available, tap to book ${durationLabel(durationMinutes).toLowerCase()}`}
                aria-label={`Book ${formatStart(c.start, r.timezone)}`}
                className={`h-6 flex-1 rounded-md ${CELL_COLOURS.available} transition hover:brightness-110 active:scale-95 disabled:cursor-wait ${busyStart === c.start ? 'animate-pulse' : ''}`}
              />
            ) : (
              <span key={c.hour} title={`${shortHour(c.hour)} · ${c.state}`} className={`h-6 flex-1 rounded-md ${CELL_COLOURS[c.state]}`} />
            ),
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-slate-500">
          {(['available', 'booked', 'unavailable'] as const).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 capitalize">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${CELL_COLOURS[s]}`} />
              {s}
            </span>
          ))}
        </div>
      </div>

      {bookError && (
        <div role="alert">
          <ErrorBanner message={bookError} />
        </div>
      )}
      {r.availableStartTimes.length === 0 ? (
        <button
          type="button"
          disabled
          className="flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 text-sm font-bold text-slate-500"
        >
          <Icon name="event_busy" className="text-[1.125rem]" />
          No slots left for this day
        </button>
      ) : (
        // The full booking window is its own page (every start time, the length), at an address that can be shared or reopened.
        <Link
          href={bookingHref(r.venue.facilityCode, r.resource.id, dateIso, durationMinutes)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-700 text-sm font-bold text-white shadow-glow transition hover:bg-brand-800 active:scale-[0.99]"
        >
          <Icon name="book" className="text-[1.125rem]" />
          Book Now
        </Link>
      )}
    </div>
  );
}

/** "Today, 25 Oct" or "Mon, 27 Oct" for the searched day. */
function dayHeading(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return dateIso === todayIso() ? `Today, ${date}` : `${d.toLocaleDateString('en-GB', { weekday: 'short' })}, ${date}`;
}
