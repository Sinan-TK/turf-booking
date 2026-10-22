'use client';

import { useFetch } from '@/lib/use-fetch';
import type { VenueCategory } from '@/lib/categories';
import { EmptyState, ErrorBanner, LoadingState, PageHeader } from '@/components/ui';
import { VenueScope } from '@/components/venue-scope';
import { WalkInForm, type WalkInResource } from '@/components/walk-in-form';

function WalkIn({ venueId }: { venueId: string }) {
  const { data: resources, error, loading } = useFetch<Array<WalkInResource & { isBookable: boolean }>>(
    `/resources?venueId=${venueId}`,
  );
  const { data: categories } = useFetch<VenueCategory[]>('/categories');

  if (error) return <ErrorBanner message={error} />;
  if (loading || !resources || !categories) return <LoadingState />;
  const open = resources.filter((r) => r.isBookable);
  if (open.length === 0) return <EmptyState message="This venue has no unit open for booking." />;
  return <WalkInForm key={venueId} resources={open} categories={categories} />;
}

export default function WalkInPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Walk-in booking"
        subtitle="Book a slot for a customer who called or walked in, and who pays you directly."
      />
      <VenueScope>{(venueId) => <WalkIn venueId={venueId} />}</VenueScope>
    </div>
  );
}
