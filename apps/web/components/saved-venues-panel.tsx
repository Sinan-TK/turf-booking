'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { FadeImage } from '@/components/fade-image';
import { useAccountData } from '@/lib/account-cache';
import { useToast } from '@/components/toast';
import { CategoryIcon, ErrorBanner, Icon } from '@/components/ui';
import { SavedCardsSkeleton } from '@/components/skeleton';
import { googleMapsLink } from '@/lib/booking';

interface SavedVenue {
  id: string;
  name: string;
  facilityCode: string;
  address: string;
  lat: number;
  lng: number;
  googleMapsUrl: string | null;
  photoUrl: string | null;
  /** Every unit that can be booked now, with its main photo. */
  units: { id: string; name: string; photoUrl: string | null; iconKey: string; iconSvg: string | null }[];
}

/** The venues the customer saved with the bookmark on the venue cards. Shown as the Saved tab of the account page. */
export function SavedVenuesPanel() {
  const toast = useToast();
  // The last answer paints at once; the live one replaces it.
  const { data: venues, setData: setVenues, error } = useAccountData('saved-venues', () => api.get<SavedVenue[]>('/me/saved-venues'), 'Could not load your saved venues.');

  /** The venue leaves the list at once; it comes back (with a message) if the server could not remove it. */
  async function remove(venue: SavedVenue) {
    const before = venues;
    setVenues((list) => (list ? list.filter((v) => v.id !== venue.id) : list));
    try {
      await api.delete(`/me/saved-venues/${venue.id}`);
    } catch {
      setVenues(before);
      toast.show('Could not remove that venue. Please try again.');
    }
  }

  return (
    <>
      {error && <ErrorBanner message={error} />}
      {!error && !venues && <SavedCardsSkeleton />}
      {venues && venues.length === 0 && (
        <p className="text-sm text-gray-500">
          No saved venues yet. Tap the bookmark on a venue&apos;s photo to save it here.
        </p>
      )}
      {venues && venues.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {venues.map((v) => (
            <li key={v.id} className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {/* One picture per bookable unit (its venue-type icon when it has none); a venue with no units shows its own photo. */}
              <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
                {v.units.length > 0 ? (
                  <UnitSlideshow name={v.name} units={v.units} />
                ) : v.photoUrl ? (
                  <div className="relative h-full w-full bg-gray-100 text-gray-300">
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Icon name="location_on" className="text-[2.5rem]" />
                    </span>
                    <FadeImage src={v.photoUrl} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-300">
                    <Icon name="location_on" className="text-[2.5rem]" />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-4 p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{v.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{v.address}</p>
                  </div>
                  <a
                    href={googleMapsLink(v)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-100 active:scale-95"
                  >
                    <Icon name="navigation" className="text-[0.875rem]" />
                    Directions
                  </a>
                </div>
                <div className="mt-auto flex gap-2">
                  <HoldToRemove label={`Remove ${v.name} from saved venues`} onHold={() => void remove(v)} onTap={() => toast.show('Press and hold Remove to remove this venue.')} />
                  <Link
                    href={`/book/${encodeURIComponent(v.facilityCode)}/any`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-800 active:scale-95"
                  >
                    Book now
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const SLIDE_MS = 2000;

/** The venue's bookable units, one picture at a time, changing every 2 seconds (still, with no motion, if the visitor asked for less). */
function UnitSlideshow({ name, units }: { name: string; units: SavedVenue['units'] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (units.length < 2 || paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % units.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [units.length, paused]);

  return (
    <div
      role="group"
      aria-label={`${name} units`}
      className="relative h-full w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {units.map((u, n) => (
        <div
          key={u.id}
          aria-hidden={n !== index}
          className={`absolute inset-0 transition-opacity duration-500 ${n === index ? 'opacity-100' : 'opacity-0'}`}
        >
          {u.photoUrl ? (
            <div className="relative h-full w-full bg-brand-50 text-brand-700">
              <span className="absolute inset-0 flex items-center justify-center">
                <CategoryIcon iconKey={u.iconKey} iconSvg={u.iconSvg} className="text-[3rem]" />
              </span>
              <FadeImage src={u.photoUrl} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-50 text-brand-700">
              <CategoryIcon iconKey={u.iconKey} iconSvg={u.iconSvg} className="text-[3rem]" />
            </div>
          )}
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-md bg-black/55 px-2 py-0.5 text-xs font-semibold text-white">{u.name}</span>
        </div>
      ))}
      {units.length > 1 && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          {units.map((u, n) => (
            <span key={u.id} className={`h-1.5 rounded-full bg-white transition-all ${n === index ? 'w-4 opacity-100' : 'w-1.5 opacity-60'}`} />
          ))}
        </div>
      )}
    </div>
  );
}

const HOLD_MS = 1000;

/**
 * The Remove button: pressed and held, it fills with red from the left, and the venue is removed when it is full.
 * Let go early and it empties again with nothing removed. Space and Enter hold it too.
 */
function HoldToRemove({ label, onHold, onTap }: { label: string; onHold: () => void; onTap: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      onHold();
    }, HOLD_MS);
  };
  const stop = (early: boolean) => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
    if (early) onTap();
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <button
      type="button"
      aria-label={label}
      title="Press and hold to remove"
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={() => stop(true)}
      onPointerLeave={() => stop(false)}
      onPointerCancel={() => stop(false)}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') stop(true);
      }}
      onBlur={() => stop(false)}
      onContextMenu={(e) => e.preventDefault()}
      className="relative flex-1 touch-none select-none overflow-hidden rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-100"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-red-600 ease-linear"
        style={{ width: holding ? '100%' : '0%', transitionProperty: 'width', transitionDuration: holding ? `${HOLD_MS}ms` : '150ms' }}
      />
      <span className={`relative transition-colors ${holding ? 'text-white' : ''}`}>Remove</span>
    </button>
  );
}
