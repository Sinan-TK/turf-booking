'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { useToast } from '@/components/toast';
import { CategoryIcon, ErrorBanner, Icon } from '@/components/ui';
import { RowsSkeleton } from '@/components/skeleton';
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
  const { refresh } = useCustomer();
  const toast = useToast();
  const [venues, setVenues] = useState<SavedVenue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SavedVenue[]>('/me/saved-venues')
      .then(setVenues)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Could not load your saved venues.');
      });
  }, [refresh]);

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
      {!error && !venues && <RowsSkeleton count={3} label="Loading your saved venues…" />}
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
              <div className="aspect-[16/9] w-full bg-gray-100">
                {v.units.length > 0 ? (
                  <ul aria-label={`${v.name} units`} className="scrollbar-hide flex h-full snap-x snap-mandatory overflow-x-auto">
                    {v.units.map((u) => (
                      <li key={u.id} className={`relative h-full shrink-0 snap-start border-r border-white/70 last:border-r-0 ${v.units.length === 1 ? 'w-full' : 'w-1/2'}`}>
                        {u.photoUrl ? (
                          <img src={u.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-brand-50 text-brand-700">
                            <CategoryIcon iconKey={u.iconKey} iconSvg={u.iconSvg} className="text-[2.5rem]" />
                          </div>
                        )}
                        <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">{u.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : v.photoUrl ? (
                  <img src={v.photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
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
                  <button
                    type="button"
                    onClick={() => void remove(v)}
                    aria-label={`Remove ${v.name} from saved venues`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 active:scale-95"
                  >
                    <Icon name="close" className="text-[1rem]" />
                    Remove
                  </button>
                  <Link
                    href={`/book/${encodeURIComponent(v.facilityCode)}/any`}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-800 active:scale-95"
                  >
                    Book now
                    <Icon name="arrow_forward" className="text-[1rem]" />
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
