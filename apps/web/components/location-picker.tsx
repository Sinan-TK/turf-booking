'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nearestTown } from '@venue/shared/dist/location';
import { api } from '@/lib/api';
import { getPosition, type LocationChoice, type Town } from '@/lib/location';
import { Icon } from '@/components/ui';
import { Skeleton } from '@/components/skeleton';

/** One searchable place: an area with the district and state it is in (from GET /places). */
interface Place extends Town {
  districtId: string;
  districtName: string;
  stateId: string;
  stateName: string;
}

const PLACES_KEY = 'bookyo.places.v1';
let placesMemory: Place[] | null = null;
let placesLoading: Promise<Place[]> | null = null;

/** The last list of places seen in this tab (the list barely changes, and is the same for everyone), so the picker opens already filled. */
function savedPlaces(): Place[] | null {
  if (placesMemory) return placesMemory;
  try {
    const raw = window.sessionStorage.getItem(PLACES_KEY);
    const rows = raw ? (JSON.parse(raw) as Place[]) : null;
    return Array.isArray(rows) && rows.length > 0 ? (placesMemory = rows) : null;
  } catch {
    return null;
  }
}

/** Fetches the places (one request at a time) and keeps them for the next opening. */
function loadPlaces(): Promise<Place[]> {
  placesLoading ??= api
    .get<Place[]>('/places')
    .then((rows) => {
      placesMemory = rows;
      try {
        window.sessionStorage.setItem(PLACES_KEY, JSON.stringify(rows));
      } catch {
        // storage full or blocked: the next opening just asks again
      }
      return rows;
    })
    .finally(() => {
      placesLoading = null;
    });
  return placesLoading;
}

/** Starts loading the places ahead of time (call it when the page is up), so the picker has no loading wait the first time either. */
export function warmPlaces(): void {
  if (!savedPlaces()) void loadPlaces().catch(() => undefined);
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Chooses where to search: the customer's current location, a whole district, or one of its towns. A full-screen
 * page on small screens (own header with a back arrow) and a centred modal from `sm` up. Closing it (Escape, the
 * back arrow, the X, the backdrop) leaves the choice as it was.
 */
export function LocationPicker({
  current,
  onChoose,
  onClose,
}: {
  current: LocationChoice | null;
  onChoose: (choice: LocationChoice) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Every place a customer can search from, in any state: "Area, District, State".
  const [places, setPlaces] = useState<Place[] | null>(() => savedPlaces());
  const [placesError, setPlacesError] = useState(false);
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // Kept, so "Use my current location" can wait for the list when it is pressed before the list has arrived.
  const placesRequest = useRef<Promise<Place[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Shown at once when seen before; the live list replaces it a moment later.
    placesRequest.current = loadPlaces();
    placesRequest.current
      .then((rows) => !cancelled && setPlaces(rows))
      .catch(() => {
        if (cancelled || savedPlaces()) return;
        setPlaces([]);
        setPlacesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus, scroll lock, Escape and a focus trap, as in the login dialog.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchBox.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  // The places of the current district come first (they are the likeliest), then the rest by name; typing filters by area, district or state.
  const shownPlaces = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = current?.districtId;
    return (places ?? [])
      .filter((p) => !q || `${p.name} ${p.districtName} ${p.stateName}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.districtId === mine) - Number(a.districtId === mine) || a.name.localeCompare(b.name));
  }, [places, query, current?.districtId]);

  const placeBase = (p: Place) => ({ stateId: p.stateId, stateName: p.stateName, districtId: p.districtId, districtName: p.districtName });
  const choosePlace = (p: Place) => {
    // An area without a centre cannot be searched "near", so it stands for its whole district.
    if (p.lat === null || p.lng === null) return onChoose({ ...placeBase(p), mode: 'district' });
    onChoose({ ...placeBase(p), mode: 'town', areaId: p.id, townName: p.name, lat: p.lat, lng: p.lng });
  };

  async function useMyLocation() {
    setGeoError(null);
    setLocating(true);
    const pos = await getPosition();
    setLocating(false);
    if (!pos.ok) return setGeoError(pos.message);
    // Name the position by the closest listed area (in any state); without one it is simply "Your location".
    const known = places ?? (await placesRequest.current?.catch(() => [] as Place[])) ?? [];
    const near = nearestTown(known, pos.lat, pos.lng);
    // Near no listed area, and with no place chosen yet (the default is still loading), the position stands on its own.
    const where = near ? placeBase(near) : current ? { stateId: current.stateId, stateName: current.stateName, districtId: current.districtId, districtName: current.districtName } : { stateId: '', stateName: '', districtId: '', districtName: '' };
    onChoose({ ...where, mode: 'geo', lat: pos.lat, lng: pos.lng, nearTown: near?.name });
  }

  const row = (selected: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm transition ${
      selected ? 'bg-brand-50 font-bold text-brand-800' : 'font-medium text-slate-800 hover:bg-slate-50'
    }`;

  return (
    <div className="fixed inset-0 z-[60] sm:flex sm:items-center sm:justify-center sm:p-4">
      {/* Backdrop: only visible from sm up, where the picker is a modal. */}
      <div className="absolute inset-0 hidden bg-slate-900/50 sm:block" onMouseDown={onClose} aria-hidden="true" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
        className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[80vh] sm:max-w-md sm:rounded-2xl sm:shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-3 sm:px-5 sm:py-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 sm:hidden"
          >
            <Icon name="arrow_back" className="text-[1.25rem]" />
          </button>
          <h2 id="location-picker-title" className="flex-1 text-base font-extrabold text-slate-900">
            Choose your location
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hidden rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:block"
          >
            <Icon name="close" className="text-[1.125rem]" />
          </button>
        </header>

        <div className="px-3 pt-3 sm:px-5">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[1rem] text-slate-400" />
            <input
              ref={searchBox}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search an area or district…"
              aria-label="Search places"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2 sm:px-3">
          <button type="button" onClick={useMyLocation} disabled={locating} className={row(current?.mode === 'geo')}>
            <Icon name="my_location" className="text-[1.125rem] text-brand-700" />
            <span className="flex-1">{locating ? 'Finding your location…' : 'Use my current location'}</span>
            {current?.mode === 'geo' && <Icon name="check" className="text-[1rem]" />}
          </button>
          {geoError && (
            <p role="alert" className="mx-3.5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {geoError}
            </p>
          )}

          <div className="mx-3.5 my-2 h-px bg-slate-100" />

          {places === null && (
            <div role="status" aria-busy="true" className="space-y-1 px-3.5 py-2">
              <span className="sr-only">Loading places…</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          )}
          {placesError && <p className="px-3.5 py-3 text-sm text-red-600">Couldn&apos;t load the places. Please try again in a moment.</p>}
          {places !== null && !placesError && places.length === 0 && <p className="px-3.5 py-3 text-sm text-slate-500">No places are listed yet.</p>}
          {places !== null && places.length > 0 && shownPlaces.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-slate-500">No place matches “{query.trim()}”.</p>
          )}
          {shownPlaces.map((p) => {
            const selected = current?.mode === 'town' && current.areaId === p.id;
            return (
              <button key={p.id} type="button" onClick={() => choosePlace(p)} className={row(selected)}>
                <Icon name="location_on" className={`text-[1.125rem] ${selected ? 'text-brand-700' : 'text-slate-400'}`} />
                <span className="min-w-0 flex-1">
                  <span className="font-bold text-slate-900">{p.name}</span>
                  <span className="text-slate-500">
                    , {p.districtName}
                  </span>
                </span>
                {selected && <Icon name="check" className="text-[1rem]" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
