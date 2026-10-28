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
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SavedVenue[]>('/me/saved-venues')
      .then(setVenues)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) return void refresh();
        setError(err instanceof ApiError ? err.message : 'Could not load your saved venues.');
      });
  }, [refresh]);

  async function remove(venue: SavedVenue) {
    setRemoving(venue.id);
    try {
      await api.delete(`/me/saved-venues/${venue.id}`);
      setVenues((list) => (list ? list.filter((v) => v.id !== venue.id) : list));
    } catch {
      toast.show('Could not remove that venue. Please try again.');
    } finally {
      setRemoving(null);
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
        <ul className="divide-y divide-gray-100">
          {venues.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{v.name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                  <Icon name="location_on" className="shrink-0 text-[0.875rem] text-gray-400" />
                  <span className="truncate">{v.address}</span>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/?q=${encodeURIComponent(v.name)}`}
                  className="rounded-xl bg-brand-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-800 active:scale-95"
                >
                  View slots
                </Link>
                <button
                  type="button"
                  onClick={() => void remove(v)}
                  disabled={removing === v.id}
                  aria-label={`Remove ${v.name} from saved venues`}
                  title="Remove from saved"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Icon name="close" className="text-[1rem]" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
