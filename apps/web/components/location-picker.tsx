'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { nearestTown } from '@venue/shared/dist/location';
import { api } from '@/lib/api';
import { getPosition, type LocationChoice, type Town } from '@/lib/location';
import { Icon, Select } from '@/components/ui';

interface Option {
  id: string;
  name: string;
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

  // The district whose towns are listed; starts at the current one and can be switched.
  const [states, setStates] = useState<Option[]>([]);
  const [districts, setDistricts] = useState<Option[]>([]);
  const [stateId, setStateId] = useState(current?.stateId ?? '');
  const [districtId, setDistrictId] = useState(current?.districtId ?? '');
  const [towns, setTowns] = useState<Town[] | null>(null);
  const [townsError, setTownsError] = useState(false);
  const [query, setQuery] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const stateName = states.find((s) => s.id === stateId)?.name ?? current?.stateName ?? '';
  const districtName = districts.find((d) => d.id === districtId)?.name ?? (districtId === current?.districtId ? current?.districtName : '') ?? '';

  useEffect(() => {
    api.get<Option[]>('/states').then(setStates).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!stateId) return setDistricts([]);
    api.get<Option[]>(`/districts?stateId=${stateId}`).then(setDistricts).catch(() => undefined);
  }, [stateId]);

  useEffect(() => {
    if (!districtId) return setTowns([]);
    let cancelled = false;
    setTowns(null);
    setTownsError(false);
    api
      .get<Array<{ id: string; name: string; lat: number | null; lng: number | null }>>(`/areas?districtId=${districtId}`)
      .then((rows) => !cancelled && setTowns(rows))
      .catch(() => {
        if (cancelled) return;
        setTowns([]);
        setTownsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [districtId]);

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

  const shownTowns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (towns ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [towns, query]);

  const base = { stateId, stateName, districtId, districtName };
  const chooseDistrict = () => onChoose({ ...base, mode: 'district' });
  const chooseTown = (t: Town) => {
    if (t.lat === null || t.lng === null) return onChoose({ ...base, mode: 'district' });
    onChoose({ ...base, mode: 'town', areaId: t.id, townName: t.name, lat: t.lat, lng: t.lng });
  };

  async function useMyLocation() {
    setGeoError(null);
    setLocating(true);
    const pos = await getPosition();
    setLocating(false);
    if (!pos.ok) return setGeoError(pos.message);
    // Name the position by the closest listed town; without one it is simply "Your location".
    const near = nearestTown(towns ?? [], pos.lat, pos.lng);
    onChoose({ ...base, mode: 'geo', lat: pos.lat, lng: pos.lng, nearTown: near?.name });
  }

  const isDistrictCurrent = current?.mode === 'district' && current.districtId === districtId;
  const row = (selected: boolean) =>
    `flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-sm transition ${
      selected ? 'bg-emerald-50 font-bold text-emerald-800' : 'font-medium text-slate-800 hover:bg-slate-50'
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
            className="rounded-full p-2 text-slate-600 hover:bg-slate-100 sm:hidden"
          >
            <Icon name="arrow_back" className="text-[20px]" />
          </button>
          <h2 id="location-picker-title" className="flex-1 text-base font-extrabold text-slate-900">
            Choose your location
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hidden rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 sm:block"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </header>

        <div className="px-3 pt-3 sm:px-5">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-slate-400" />
            <input
              ref={searchBox}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search a town in ${districtName || 'this district'}…`}
              aria-label="Search towns"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2 sm:px-3">
          <button type="button" onClick={useMyLocation} disabled={locating} className={row(current?.mode === 'geo')}>
            <Icon name="my_location" className="text-[18px] text-emerald-700" />
            <span className="flex-1">{locating ? 'Finding your location…' : 'Use my current location'}</span>
            {current?.mode === 'geo' && <Icon name="check" className="text-[16px]" />}
          </button>
          {geoError && (
            <p role="alert" className="mx-3.5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {geoError}
            </p>
          )}

          <div className="mx-3.5 my-2 h-px bg-slate-100" />

          {districtName && (
            <button type="button" onClick={chooseDistrict} className={row(isDistrictCurrent)}>
              <Icon name="location_on" className={`text-[18px] ${isDistrictCurrent ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span className="flex-1">All of {districtName}</span>
              {isDistrictCurrent && <Icon name="check" className="text-[16px]" />}
            </button>
          )}

          {towns === null && <p className="px-3.5 py-3 text-sm text-slate-400">Loading towns…</p>}
          {townsError && <p className="px-3.5 py-3 text-sm text-red-600">Couldn&apos;t load the towns. Choose All of {districtName || 'the district'}.</p>}
          {towns !== null && !townsError && towns.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-slate-500">No towns are listed for {districtName || 'this district'} yet.</p>
          )}
          {towns !== null && towns.length > 0 && shownTowns.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-slate-500">No town matches “{query.trim()}”.</p>
          )}
          {shownTowns.map((t) => {
            const selected = current?.mode === 'town' && current.areaId === t.id;
            return (
              <button key={t.id} type="button" onClick={() => chooseTown(t)} className={row(selected)}>
                <Icon name="location_on" className={`text-[18px] ${selected ? 'text-emerald-700' : 'text-slate-400'}`} />
                <span className="flex-1">{t.name}</span>
                {selected && <Icon name="check" className="text-[16px]" />}
              </button>
            );
          })}

          <div className="mx-3.5 mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowOther((v) => !v)}
              aria-expanded={showOther}
              className="flex w-full items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              Other district
              <Icon name="expand_more" className={`text-[16px] transition ${showOther ? 'rotate-180' : ''}`} />
            </button>
            {showOther && (
              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="picker-state" className="mb-1 block text-xs font-semibold text-slate-500">
                    State
                  </label>
                  <Select
                    id="picker-state"
                    value={stateId}
                    onChange={(e) => {
                      setStateId(e.target.value);
                      setDistrictId('');
                    }}
                    className="w-full"
                  >
                    <option value="">Select state…</option>
                    {states.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="picker-district" className="mb-1 block text-xs font-semibold text-slate-500">
                    District
                  </label>
                  <Select
                    id="picker-district"
                    disabled={!stateId}
                    value={districtId}
                    onChange={(e) => {
                      setDistrictId(e.target.value);
                      setQuery('');
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
