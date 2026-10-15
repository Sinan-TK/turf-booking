'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import type { VenueCategorySummary } from '@/lib/categories';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  SearchInput,
} from '@/components/ui';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  status: string;
  address: string;
  category?: VenueCategorySummary;
}

export default function VenuesPage() {
  const { data, error, loading } = useFetch<Venue[]>('/venues/mine');
  const [search, setSearch] = useState('');

  const filtered = data?.filter((venue) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      venue.name.toLowerCase().includes(q) ||
      venue.facilityCode.toLowerCase().includes(q) ||
      venue.address.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="My Venues"
        action={
          <Link href="/venues/new">
            <Button>New Venue</Button>
          </Link>
        }
      />
      {data && data.length > 0 && (
        <SearchInput
          placeholder="Search venues by name, code, or address…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 max-w-md"
        />
      )}
      {loading && <LoadingState />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && (
        <EmptyState message="You haven't added a venue yet. Create one to get started." />
      )}
      {filtered && filtered.length === 0 && data && data.length > 0 && (
        <EmptyState message="No venues match your search." />
      )}
      {filtered && filtered.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low text-xs uppercase text-on-surface-variant">
              <tr>
                <th className="px-4 py-3">Facility Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((venue) => (
                <tr key={venue.id} className="border-b border-outline-variant/20 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{venue.facilityCode}</td>
                  <td className="px-4 py-3 font-medium text-on-surface">{venue.name}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{venue.category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{venue.address}</td>
                  <td className="px-4 py-3">
                    <Badge value={venue.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/venues/${venue.id}`} className="text-sm font-medium text-primary hover:underline">
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
