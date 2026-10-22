'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { EmptyState, Label, Select } from '@/components/ui';

/**
 * Runs a venue-based page for one venue. Staff always work in the venue chosen in the header; an
 * owner admin, who has no such choice, picks one here when the organization has several.
 */
export function VenueScope({ children }: { children: (venueId: string, venueName: string) => React.ReactNode }) {
  const { user, isStaff, selectedVenue } = useAuth();
  const [picked, setPicked] = useState<string | null>(null);

  if (!user) return null;
  if (user.venues.length === 0) {
    return <EmptyState message={isStaff ? 'No venue is assigned to you yet.' : 'Add a venue first.'} />;
  }

  const venue = isStaff
    ? selectedVenue
    : (user.venues.find((v) => v.id === picked) ?? user.venues[0]);
  if (!venue) return null;

  return (
    <div className="space-y-4">
      {!isStaff && user.venues.length > 1 && (
        <div className="max-w-xs">
          <Label htmlFor="venue-scope">Venue</Label>
          <Select id="venue-scope" value={venue.id} onChange={(e) => setPicked(e.target.value)}>
            {user.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {children(venue.id, venue.name)}
    </div>
  );
}
