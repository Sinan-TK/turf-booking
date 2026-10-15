'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ErrorBanner, Icon, LoadingState, Select, WhatsAppIcon } from '@/components/ui';
import { durationLabel, shortDuration, type VenueCategory } from '@/lib/categories';

interface StateOption {
  id: string;
  name: string;
}
interface District {
  id: string;
  name: string;
}
interface SearchResult {
  venue: { id: string; name: string; facilityCode: string; address: string; photoUrl: string | null; lat: number; lng: number };
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
  price: { amount: string; currency: string } | null;
}

// Shown when a venue has no opening hours configured.
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

function formatPrice(price: { amount: string; currency: string }): string {
  const n = Number(price.amount);
  const value = Number.isFinite(n) ? String(n) : price.amount;
  const symbol = CURRENCY_SYMBOLS[price.currency?.toUpperCase()];
  return symbol ? `${symbol}${value}` : `${price.currency} ${value}`;
}

/** Google Maps directions/search link for a venue — precise pin when
 * coordinates exist, address-text search otherwise. */
function googleMapsLink(venue: { lat?: number; lng?: number; name: string; address: string }): string {
  const query =
    venue.lat !== undefined && venue.lng !== undefined
      ? `${venue.lat},${venue.lng}`
      : `${venue.name}, ${venue.address}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Next 7 calendar days (today first), for the 1-tap date strip. */
function next7Days(): Array<{ iso: string; weekday: string; day: string; month: string; isToday: boolean }> {
  return Array.from({ length: 7 }, (_, i) => {
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

/** The WhatsApp Business number customers message to book — set once as a
 * deploy-time env var (see apps/web/.env.local / the Vercel project
 * settings for this app), never hardcoded here. Digits only, with country
 * code, no leading '+' (wa.me's own format). */
const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

function whatsappLink(text: string): string | null {
  if (!WHATSAPP_NUMBER) return null;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

/**
 * The exact text format apps/api/src/whatsapp/whatsapp-menu.service.ts's
 * parseBookIntentText expects — machine-generated, matched by a strict
 * regex on the bot side. Keep the two in sync if this ever changes.
 */
function bookSlotIntentText(r: SearchResult, startTime: string, durationMinutes: number): string {
  return `Book: ${r.venue.facilityCode} | Resource: ${r.resource.id} | ${startTime} | ${durationMinutes}min`;
}

export default function HomePage() {
  const [states, setStates] = useState<StateOption[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [stateId, setStateId] = useState('');

  const [locationMode, setLocationMode] = useState<'district' | 'geo'>('district');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);

  const [form, setForm] = useState({
    districtId: '',
    categorySlug: '',
    groundType: '',
    date: todayIso(),
    timeWindow: 'ALL',
    durationMinutes: 60,
  });
  const [districtName, setDistrictName] = useState('');
  // Granular reverse-geocoded place names for the header: town (or
  // suburb) and city, plus the raw state name when it matches nothing
  // seeded (e.g. outside Kerala). districtName stays the district-level
  // label used for searching and headings.
  const [townName, setTownName] = useState('');
  const [cityName, setCityName] = useState('');
  const [fallbackStateName, setFallbackStateName] = useState('');

  const [nameFilter, setNameFilter] = useState('');
  const [sortBy, setSortBy] = useState<'price' | 'distance'>('price');

  // Active venue types (Super-Admin managed) drive the filter chips.
  const [categories, setCategories] = useState<VenueCategory[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Both /states and /districts are public reads (apps/api/src/locations/
  // locations.controller.ts) — no booking session needed for a first-time
  // visitor just browsing.
  useEffect(() => {
    api
      .get<StateOption[]>('/states')
      .then(setStates)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .get<VenueCategory[]>('/categories')
      .then(setCategories)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!stateId) {
      setDistricts([]);
      return;
    }
    api
      .get<District[]>(`/districts?stateId=${stateId}`)
      .then(setDistricts)
      .catch(() => undefined);
  }, [stateId]);

  /**
   * Reverse-geocodes a coordinate (via OpenStreetMap's free Nominatim
   * API — no key required, but best-effort only: no retry, and any
   * failure is swallowed since the geo-radius search itself already
   * works off raw lat/lng regardless) and matches the result against
   * this platform's own seeded states/districts. Also captures the
   * granular town/city for the header ("town, city" / district on line
   * two, falling back to "city, district" / state when there is no
   * town). Falls back to the raw geocoded place name when it doesn't
   * match a seeded district (e.g. outside Kerala) rather than showing
   * nothing at all.
   */
  async function resolveLocationLabel(lat: number, lng: number) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
        { headers: { Accept: 'application/json' } },
      );
      if (!res.ok) return;
      const data: { address?: Record<string, string> } = await res.json();
      const addr = data.address ?? {};
      const geocodedState = addr.state;
      const geocodedDistrictCandidates = [addr.county, addr.state_district, addr.city, addr.town, addr.suburb].filter(
        (v): v is string => Boolean(v),
      );
      const town = addr.town ?? addr.suburb ?? '';
      const city = addr.city ?? addr.county ?? '';

      const matchedState = geocodedState
        ? states.find(
            (s) =>
              s.name.toLowerCase() === geocodedState.toLowerCase() ||
              geocodedState.toLowerCase().includes(s.name.toLowerCase()),
          )
        : undefined;

      if (matchedState) {
        const districtList = await api.get<District[]>(`/districts?stateId=${matchedState.id}`);
        const matchedDistrict = districtList.find((d) =>
          geocodedDistrictCandidates.some(
            (c) =>
              c.toLowerCase() === d.name.toLowerCase() ||
              c.toLowerCase().includes(d.name.toLowerCase()) ||
              d.name.toLowerCase().includes(c.toLowerCase()),
          ),
        );
        if (matchedDistrict) {
          setStateId(matchedState.id);
          setDistricts(districtList);
          setForm((f) => ({ ...f, districtId: matchedDistrict.id }));
          setDistrictName(matchedDistrict.name);
          // Don't echo the district back as town/city on line one.
          const sameAsDistrict = (v: string) =>
            v !== '' && v.toLowerCase() === matchedDistrict.name.toLowerCase();
          setTownName(sameAsDistrict(town) ? '' : town);
          setCityName(sameAsDistrict(city) ? '' : city);
          setFallbackStateName('');
          return;
        }
      }

      setTownName(town);
      setCityName(city);
      setFallbackStateName(geocodedState ?? '');
      const fallbackLabel = [geocodedDistrictCandidates[0], geocodedState].filter(Boolean).join(', ');
      if (fallbackLabel) setDistrictName(fallbackLabel);
    } catch {
      // Best-effort — the geo-radius search doesn't depend on this label.
    }
  }

  /** `onSuccess` fires only once a real position comes back — used by the
   * location sidebar to close itself, without closing on a failed/denied
   * attempt (the error needs to stay visible instead). */
  function useMyLocation(onSuccess?: () => void) {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Your browser does not support location access.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationMode('geo');
        setLocating(false);
        void resolveLocationLabel(pos.coords.latitude, pos.coords.longitude);
        onSuccess?.();
      },
      () => {
        setGeoError('Could not get your location — please allow location access, or pick a district instead.');
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  }

  const runSearch = useCallback(async () => {
    if (locationMode === 'district' && !form.districtId) {
      setErrorMessage('Please select a district, or use your location instead.');
      return;
    }
    if (locationMode === 'geo' && !geo) {
      setErrorMessage('Please share your location first.');
      return;
    }
    setSearching(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({
        date: form.date,
        timeWindow: form.timeWindow,
        durationMinutes: String(form.durationMinutes),
      });
      if (locationMode === 'geo' && geo) {
        params.set('lat', String(geo.lat));
        params.set('lng', String(geo.lng));
        params.set('radiusKm', '15');
      } else {
        params.set('districtId', form.districtId);
      }
      // Both filters are optional: no category = every venue type, no
      // sub-type = every kind of unit. The API owns the filtering.
      if (form.categorySlug) params.set('categorySlug', form.categorySlug);
      if (form.groundType) params.set('groundType', form.groundType);
      const data = await api.get<SearchResult[]>(`/search?${params.toString()}`);
      setResults(data);
      setSearched(true);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  }, [
    locationMode,
    geo,
    form.districtId,
    form.categorySlug,
    form.groundType,
    form.date,
    form.timeWindow,
    form.durationMinutes,
  ]);

  // Re-search automatically whenever a filter that's cheap to react to
  // changes (date, ground type, duration, or district once picked) —
  // matches the "1-tap" feel: no separate submit button to hunt for.
  useEffect(() => {
    if (locationMode === 'district' && form.districtId) runSearch();
    if (locationMode === 'geo' && geo) runSearch();
    // Deliberately omits runSearch itself from the dependency array —
    // it already reads every field listed below, and depending on its
    // own identity here would re-run this effect on every render.
  }, [
    locationMode,
    geo,
    form.districtId,
    form.categorySlug,
    form.groundType,
    form.date,
    form.timeWindow,
    form.durationMinutes,
  ]);

  const visibleResults = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    const filtered = q
      ? results.filter(
          (r) => r.venue.name.toLowerCase().includes(q) || r.venue.address.toLowerCase().includes(q) || r.resource.groundType.toLowerCase().includes(q),
        )
      : results;
    return [...filtered].sort((a, b) => {
      if (sortBy === 'distance') {
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      }
      return Number(a.price?.amount ?? Infinity) - Number(b.price?.amount ?? Infinity);
    });
  }, [results, nameFilter, sortBy]);

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

  const generalWhatsappLink = whatsappLink('Hi! I want to make a booking.');
  const days = useMemo(() => next7Days(), []);

  // Header location lines: line one is a single value — the most
  // granular place known (town, else city, else district); line two
  // carries the next two levels ("city, district"), falling back to the
  // state when there is nothing below line one. Nothing selected yet →
  // the "Select Location / Tap to change" placeholder pair.
  const headerStateName =
    states.find((s) => s.id === stateId)?.name ?? fallbackStateName;
  const headerLineOne = townName || cityName || districtName || 'Select Location';
  const headerLineTwo =
    headerLineOne === 'Select Location'
      ? 'Tap to change'
      : [cityName, districtName]
          .filter(
            (v) => v !== '' && v.toLowerCase() !== headerLineOne.toLowerCase(),
          )
          .join(', ') || headerStateName || 'Tap to change';

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-emerald-900/10 pt-3 pb-0">
        <div className="mx-auto w-full max-w-screen-xl px-4 sm:px-6 lg:px-8">
        {/* Top row: location · (search, inline from md up) · WhatsApp. Below md the search box wraps to its own full-width row. */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 md:flex-nowrap md:gap-x-6">
          <button onClick={() => setLocationModalOpen(true)} className="flex items-center gap-2 text-slate-700 hover:text-slate-900 transition py-1 text-left group md:order-1" type="button">
            <svg className="w-6 h-6 text-brand-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"></path></svg>
            <div className="flex flex-col items-start text-left">
              <span className="font-black text-slate-900 text-sm tracking-tight leading-tight">{headerLineOne}</span>
              <span className="text-[10px] font-medium text-slate-500 leading-tight">
                {headerLineTwo}
              </span>
            </div>
          </button>
          {generalWhatsappLink && (
            <a href={generalWhatsappLink} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp Chat" className="md:order-3 w-9 h-9 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 hover:text-slate-900 active:bg-slate-50 transition active:scale-95">
              <WhatsAppIcon className="w-5 h-5 text-slate-600" />
            </a>
          )}
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
                <Icon name={c.iconKey} className={`text-[16px] ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{c.name}</span>
              </button>
            );
          })}
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
                  className={`flex-shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold transition ${isActive ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400'}`}
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
        <div className="mx-auto flex w-full max-w-screen-xl items-center space-x-2 overflow-x-auto px-4 scrollbar-hide scroll-smooth sm:space-x-3 sm:px-6 lg:px-8">
          {days.map((d) => {
            const isActive = form.date === d.iso;
            return (
              <button 
                key={d.iso} 
                onClick={() => setForm((f) => ({ ...f, date: d.iso }))}
                className={`flex-shrink-0 flex flex-col items-center justify-center py-2.5 px-3.5 rounded-2xl min-w-[64px] sm:min-w-[84px] sm:py-3 transition-all active:scale-95 ${isActive ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand-500/40 shadow-lg border border-brand-400' : 'bg-white border border-slate-200 text-slate-800 hover:border-slate-300 shadow-sm'}`}
              >
                <span className={`text-[9px] uppercase leading-none ${isActive ? 'font-extrabold tracking-wider text-brand-100' : 'font-bold text-slate-400'}`}>{d.weekday}</span>
                <span className={`text-lg font-black my-0.5 leading-tight ${isActive ? '' : 'text-slate-900'}`}>{d.day}</span>
                <span className={`text-[10px] leading-none ${isActive ? 'font-semibold text-brand-50' : 'font-medium text-slate-400'}`}>{d.month}</span>
              </button>
            );
          })}
        </div>
      </section>

      <main className="mx-auto w-full max-w-screen-xl flex-1 px-4 pb-24 sm:px-6 lg:px-8">
        {geoError && <p className="mb-4 text-xs text-red-600">{geoError}</p>}
        {errorMessage && <div className="mb-4"><ErrorBanner message={errorMessage} /></div>}
        {searching && <LoadingState message="Checking live availability…" />}
        {!searching && searched && visibleResults.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
            Nothing available for that search. Try a different time, date, type, or location.
          </div>
        )}
        <div className="flex flex-col gap-3 sm:gap-5">
          {visibleResults.map((r) => {
            // The modal edits duration, which re-searches: look the card's
            // venue+resource up in the live results so open modals refresh
            // their slots/prices instead of going stale.
            const live =
              results.find((x) => x.venue.id === r.venue.id && x.resource.id === r.resource.id) ?? r;
            const cardProps = {
              result: r,
              liveResult: live,
              durationMinutes: form.durationMinutes,
              dateIso: form.date,
              reloading: searching,
              onDurationChange: (m: number) => setForm((f) => ({ ...f, durationMinutes: m })),
            };
            return (
              <div key={`${r.venue.id}-${r.resource.id}`}>
                <MobileVenueCard {...cardProps} />
                <DesktopVenueCard {...cardProps} />
              </div>
            );
          })}
        </div>
      </main>

      {locationModalOpen && (
        <LocationSidebar
          states={states}
          districts={districts}
          stateId={stateId}
          districtId={form.districtId}
          locating={locating}
          geoError={geoError}
          usingMyLocation={locationMode === 'geo' && geo !== null}
          onSelectState={setStateId}
          onSelectDistrict={(id, name) => {
            setDistrictName(name);
            // Manual district pick has no granular place — clear any
            // stale town/city from an earlier geolocation.
            setTownName('');
            setCityName('');
            setFallbackStateName('');
            setLocationMode('district');
            setForm((f) => ({ ...f, districtId: id }));
            setLocationModalOpen(false);
          }}
          onUseMyLocation={() => useMyLocation(() => setLocationModalOpen(false))}
          onClose={() => setLocationModalOpen(false)}
        />
      )}
    </>
  );
}

interface LocationSidebarProps {
  states: StateOption[];
  districts: District[];
  stateId: string;
  districtId: string;
  locating: boolean;
  geoError: string | null;
  usingMyLocation: boolean;
  onSelectState: (id: string) => void;
  onSelectDistrict: (id: string, name: string) => void;
  onUseMyLocation: () => void;
  onClose: () => void;
}

function LocationSidebar({
  states,
  districts,
  stateId,
  districtId,
  locating,
  geoError,
  usingMyLocation,
  onSelectState,
  onSelectDistrict,
  onUseMyLocation,
  onClose,
}: LocationSidebarProps) {
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trigger the opening animation safely after the component mounts
  useEffect(() => {
    // A slight delay (50ms) is much more robust across different browsers
    // than requestAnimationFrame for ensuring the initial off-screen paint finishes
    // before the transition begins.
    const openTimer = setTimeout(() => {
      setShown(true);
    }, 50);

    return () => clearTimeout(openTimer);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function beginClose() {
    setShown(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // Wait for the duration of the transition (300ms) before unmounting
    closeTimer.current = setTimeout(onClose, 300);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') beginClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Prevent background scrolling while the sidebar is open
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

  return (
    <div className="fixed inset-0 z-[60] flex" role="dialog" aria-modal="true" aria-label="Choose your location">
      {/* Sidebar Panel */}
      <div
        className={`relative z-10 flex h-full w-full max-w-xs flex-col overflow-y-auto bg-white p-5 shadow-xl transition-transform duration-300 ease-in-out sm:p-6 ${
          shown ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-base font-extrabold text-slate-900">
            <Icon name="location_on" className="text-[20px]" />
            Choose your location
          </h3>
          <button type="button" onClick={beginClose} aria-label="Close" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <button
          type="button"
          disabled={locating}
          onClick={onUseMyLocation}
          className={`mb-4 flex items-center gap-2 rounded-xl border px-3.5 py-3 text-sm font-bold transition-all ${
            usingMyLocation ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Icon name="my_location" className="text-[18px]" />
          {locating ? 'Locating…' : usingMyLocation ? 'Using your current location' : 'Use my current location'}
        </button>
        
        {geoError && <p className="mb-4 -mt-2 text-xs text-red-600">{geoError}</p>}

        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> or pick manually <span className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">State</label>
            <Select value={stateId} onChange={(e) => onSelectState(e.target.value)} className="w-full">
              <option value="">Select state…</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">District</label>
            <Select
              disabled={!stateId}
              value={districtId}
              onChange={(e) => {
                const d = districts.find((x) => x.id === e.target.value);
                if (d) onSelectDistrict(d.id, d.name);
              }}
              className="w-full"
            >
              <option value="">Select district…</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ease-in-out ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={beginClose}
        aria-hidden="true"
      />
    </div>
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
 * day. Picking a slot enables "Continue on WhatsApp", which deep-links
 * the bot-parseable intent (bookSlotIntentText — same shape the
 * WhatsApp menu's Book flow matches on), not a free-text message.
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

  const confirmLink = selected ? whatsappLink(bookSlotIntentText(r, selected, durationMinutes)) : null;

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
                <Icon name={r.category?.iconKey ?? 'category'} className="text-[24px]" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Book your slot</p>
              <h3 className="mt-0.5 truncate text-lg font-black tracking-tight text-slate-900">{r.venue.name}</h3>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {r.venue.address}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                {r.distanceKm !== undefined && (
                  <span className="text-[11px] font-semibold text-emerald-700">
                    {r.distanceKm} km away
                  </span>
                )}
                <a
                  href={googleMapsLink(r.venue)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
                >
                  <Icon name="location_on" className="text-[14px]" />
                  Directions
                </a>
              </div>
            </div>
          </div>
          <button type="button" onClick={beginClose} aria-label="Close" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
            {formatDateLabel(dateIso)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 font-bold text-slate-700 ring-1 ring-slate-200">
            {r.resource.name} · {r.resource.groundType}
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
                  {displayPrice && (
                    <span className={`shrink-0 text-[11px] font-black ${active ? 'text-emerald-100' : 'text-emerald-700'}`}>
                      {formatPrice(displayPrice)}
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
              {formatDateLabel(dateIso)} · {formatTimeRange(selected, durationMinutes, r.timezone)} · {displayPrice ? formatPrice(displayPrice) : ''}
            </p>
          )}
          {confirmLink ? (
            <a
              href={confirmLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-extrabold text-white shadow-md transition active:scale-95 ${
                selected ? 'bg-[#25D366] hover:bg-[#20ba59]' : 'pointer-events-none bg-slate-300'
              }`}
              aria-disabled={!selected}
            >
              <WhatsAppIcon className="h-4 w-4" />
              {selected ? 'Continue on WhatsApp' : 'Select a slot above'}
            </a>
          ) : (
            <p className="rounded-xl bg-slate-100 p-3 text-center text-xs font-semibold text-slate-500">
              WhatsApp booking is not configured right now — please try again later.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MobileVenueCard({
  result: r,
  liveResult,
  durationMinutes,
  dateIso,
  reloading,
  onDurationChange,
}: {
  result: SearchResult;
  liveResult: SearchResult;
  durationMinutes: number;
  dateIso: string;
  reloading: boolean;
  onDurationChange: (minutes: number) => void;
}) {
  const hasSlots = r.availableStartTimes.length > 0;
  const generalLink = whatsappLink(`Hi, I want to inquire about ${r.venue.name}`);
  const [slotModalOpen, setSlotModalOpen] = useState(false);

  const timeline = useMemo(() => buildTimeline(r), [r]);

  return (
    <>
    <div className="sm:hidden bg-white rounded-2xl border border-slate-200/90 shadow-card pt-4 px-4 pb-0 overflow-x-hidden hover:border-emerald-500/40 transition-all flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            {/* Using a placeholder since we don't have venue image from the api right now, using stadium icon as fallback */}
            <div className="w-14 h-14 rounded-xl border-2 border-emerald-500/30 shadow-sm flex items-center justify-center bg-slate-50 text-emerald-600">
              <Icon name={r.category?.iconKey ?? 'category'} className="text-[28px]" />
            </div>
            <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center">
              <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"></path></svg>
            </span>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <h2 className="text-base font-black text-slate-900 tracking-tight leading-snug mb-1 truncate">{r.venue.name}</h2>
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800">
                <svg className="w-3 h-3 text-emerald-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polygon points="12 6 15 11 10 14 14 17 8 18"></polygon></svg>
                {r.resource.groundType}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span className="flex items-center gap-1 text-slate-600 font-medium">
                <svg className="w-3.5 h-3.5 text-brand-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                {r.venue.address.split(',')[0] || r.venue.address}
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-[11px] text-slate-400">{r.resource.name}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              {r.distanceKm !== undefined && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                  <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
                  {r.distanceKm} km away
                </span>
              )}
              <a
                href={googleMapsLink(r.venue)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
              >
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                Directions
              </a>
            </div>
          </div>
        </div>
        {r.price && (
          <div className="bg-emerald-50 border border-emerald-500/20 px-2.5 py-1 rounded-xl text-right shrink-0">
            <span className="text-[9px] uppercase font-bold text-emerald-700 block leading-none">From</span>
            <div className="flex items-baseline justify-end text-venue-primary leading-tight mt-0.5">
              <span className="text-base font-black tracking-tight">{formatPrice(r.price)}</span>
              <span className="text-[10px] font-medium text-slate-500 ml-0.5">/{shortDuration(durationMinutes)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-emerald-500/20 -mx-4">
        <div className="flex flex-col gap-2 bg-emerald-50/50 p-4 rounded-b-2xl">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-extrabold uppercase tracking-wider text-slate-800 text-[10px]">DAY TIMELINE OCCUPANCY</span>
            <div className="flex items-center gap-2 text-slate-500 font-medium text-[9px] flex-wrap">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500"></span> Available</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-slate-300"></span> Booked</span>
            </div>
          </div>
          
          <div className="flex items-center gap-1 w-full">
            {timeline.hours.map((h) => {
              const t = timeline.available.has(h);
              return t ? (
                <div key={h} title={`${hourLabel(h)} - Available`} className="flex-1 h-2 rounded-sm bg-emerald-500 shadow-sm"></div>
              ) : (
                <div key={h} title={`${hourLabel(h)} - Booked`} className="flex-1 h-2 rounded-sm bg-slate-200"></div>
              );
            })}
          </div>
          
          <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 px-0.5">
            <span>{timeline.labels[0]}</span>
            <span>{timeline.labels[1]}</span>
            <span>{timeline.labels[2]}</span>
          </div>

          <div className="pt-2 mt-1 border-t border-emerald-500/20 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => hasSlots && setSlotModalOpen(true)}
              disabled={!hasSlots}
              className={`flex-1 py-2 px-3 rounded-xl text-white font-extrabold text-xs flex items-center justify-center gap-1.5 transition shadow-sm active:scale-95 ${hasSlots ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400 cursor-not-allowed'}`}
            >
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"></path></svg>
              <span>{hasSlots ? `Book Now · ${r.availableStartTimes.length} slots` : 'No Slots Today'}</span>
            </button>
            {generalLink && (
              <a 
                href={generalLink} 
                target="_blank" 
                rel="noopener noreferrer"
                className="py-2 px-3.5 rounded-xl bg-[#25D366]/10 text-emerald-800 hover:bg-[#25D366]/20 font-bold text-xs flex items-center gap-1.5 border border-emerald-500/20 transition shadow-sm shrink-0"
              >
                <svg className="w-3.5 h-3.5 fill-current text-emerald-600" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"></path></svg>
                <span>Chat</span>
              </a>
            )}
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

function DesktopVenueCard({
  result: r,
  liveResult,
  durationMinutes,
  dateIso,
  reloading,
  onDurationChange,
}: {
  result: SearchResult;
  liveResult: SearchResult;
  durationMinutes: number;
  dateIso: string;
  reloading: boolean;
  onDurationChange: (minutes: number) => void;
}) {
  const hasSlots = r.availableStartTimes.length > 0;
  const [slotModalOpen, setSlotModalOpen] = useState(false);

  return (
    <>
    <article className="hidden sm:block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:shadow-lg">
      <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-12 lg:divide-x lg:divide-y-0">
        {/* Left: info */}
        <div className="flex flex-col justify-between p-5 sm:p-6 lg:col-span-5">
          <div>
            <div className="mb-2.5 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
                  <Icon name={r.category?.iconKey ?? 'category'} className="text-[28px]" />
                </div>
                <div>
                  <span className="mb-1 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    {r.resource.name} · {r.resource.groundType}
                  </span>
                  <h3 className="text-xl font-bold leading-snug text-slate-900">{r.venue.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <Icon name="location_on" className="text-[14px]" />
                    {r.venue.address}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    {r.distanceKm !== undefined && (
                      <span className="text-[11px] font-semibold text-emerald-700">
                        {r.distanceKm} km away
                      </span>
                    )}
                    <a
                      href={googleMapsLink(r.venue)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
                    >
                      <Icon name="location_on" className="text-[14px]" />
                      Directions
                    </a>
                  </div>
                </div>
              </div>
              {r.price && (
                <div className="flex shrink-0 flex-col items-end">
                  <span className="text-[11px] font-semibold text-slate-400">
                    {durationLabel(durationMinutes)} rate
                  </span>
                  <span className="text-2xl font-black text-emerald-700">
                    {formatPrice(r.price)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {hasSlots && (
            <div className="mt-5 border-t border-slate-100 pt-3.5">
              <button
                type="button"
                onClick={() => setSlotModalOpen(true)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:from-emerald-500 hover:to-emerald-600 active:scale-95"
              >
                <Icon name="bolt" className="text-[18px]" />
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
                <Icon name="schedule" className="text-[16px]" />
                Tap Slot to Instant Book
              </span>
              <span className="text-[11px] font-semibold text-emerald-700">
                {r.availableStartTimes.length} slot{r.availableStartTimes.length === 1 ? '' : 's'} open
              </span>
            </div>

            {r.availableStartTimes.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
                No open slots for this duration on this day.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {r.availableStartTimes.map((t) => {
                  const link = whatsappLink(bookSlotIntentText(r, t, durationMinutes));
                  return link ? (
                    <a
                      key={t}
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/60 p-2.5 shadow-sm transition-all hover:border-emerald-600 hover:bg-emerald-600 hover:text-white"
                    >
                      <span className="flex flex-col text-left">
                        <span className="text-xs font-extrabold text-slate-900 group-hover:text-white">{formatStart(t, r.timezone)}</span>
                        {r.price && (
                          <span className="text-[10px] font-bold text-emerald-700 group-hover:text-emerald-100">
                            {formatPrice(r.price)}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold uppercase text-white group-hover:bg-white group-hover:text-emerald-900">
                        <WhatsAppIcon className="h-2.5 w-2.5" />
                        Book
                      </span>
                    </a>
                  ) : (
                    <div key={t} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-2.5 opacity-60">
                      <span className="text-xs font-semibold text-slate-700">{formatTimeRange(t, durationMinutes, r.timezone)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
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
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-800">Day Timeline</span>
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
      <div className="flex justify-between pt-1 text-[9px] font-semibold text-slate-400">
        <span>{timeline.labels[0]}</span>
            <span>{timeline.labels[1]}</span>
            <span>{timeline.labels[2]}</span>
      </div>
    </div>
  );
}

