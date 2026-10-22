'use client';

import { PageHeader } from '@/components/ui';
import { DayBookings } from '@/components/day-bookings';
import { VenueScope } from '@/components/venue-scope';

export default function DayViewPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Day view" subtitle="Every booking at the venue for one day, in time order." />
      <VenueScope>{(venueId) => <DayBookings key={venueId} venueId={venueId} />}</VenueScope>
    </div>
  );
}
