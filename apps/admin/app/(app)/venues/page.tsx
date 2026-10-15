'use client';

import Link from 'next/link';
import { useFetch } from '@/lib/use-fetch';
import type { VenueCategorySummary } from '@/lib/categories';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, SkeletonTable } from '@/components/ui';

interface Venue {
  id: string;
  facilityCode: string;
  name: string;
  status: string;
  address: string;
  organizationId: string;
  category?: VenueCategorySummary;
}

export default function VenuesPage() {
  const { data, error, loading } = useFetch<Venue[]>('/venues/mine');

  return (
    <div>
      <PageHeader
        title="Venues"
        action={
          <Link href="/venues/new">
            <Button>New Venue</Button>
          </Link>
        }
      />
      {loading && <SkeletonTable columns={6} />}
      {error && <ErrorBanner message={error} />}
      {data && data.length === 0 && <EmptyState message="No venues yet." />}
      {data && data.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
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
              {data.map((venue) => (
                <tr key={venue.id} className="border-b border-gray-100 last:border-0 transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3 font-mono text-xs">{venue.facilityCode}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{venue.name}</td>
                  <td className="px-4 py-3 text-gray-600">{venue.category?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{venue.address}</td>
                  <td className="px-4 py-3">
                    <Badge value={venue.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/venues/${venue.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                      View →
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
