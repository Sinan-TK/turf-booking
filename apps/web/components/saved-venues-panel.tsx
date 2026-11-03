'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useCustomer } from '@/lib/customer';
import { useToast } from '@/components/toast';
import { Card, ErrorBanner, Icon } from '@/components/ui';
import { RowsSkeleton } from '@/components/skeleton';

interface SavedVenue {
  id: string;
  name: string;
  address: string;
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
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Saved venues</h2>
      {error && <ErrorBanner message={error} />}
      {!error && !venues && <RowsSkeleton count={3} label="Loading your saved venues…" />}
      {venues && venues.length === 0 && (
        <p className="text-sm text-gray-500">
          No saved venues yet. Tap the bookmark on a venue&apos;s photo to save it here.
        </p>
      )}
      {venues && venues.length > 0 && (
        <ul className="space-y-2">
          {venues.map((v) => (
            <li key={v.id} className="relative">
              {/* The whole row opens the venue; the remove button sits on top of it, not inside the link. */}
              <Link
                href={`/explore?q=${encodeURIComponent(v.name)}`}
                className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white py-3 pl-3 pr-12 transition hover:border-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon name="location_on" className="text-[1.25rem]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{v.name}</span>
                  <span className="block truncate text-xs text-gray-500">{v.address}</span>
                </span>
                <Icon name="chevron_right" className="shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-500" />
              </Link>
              <button
                type="button"
                onClick={() => void remove(v)}
                aria-label={`Remove ${v.name} from saved venues`}
                title="Remove from saved"
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Icon name="close" className="text-[1rem]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
