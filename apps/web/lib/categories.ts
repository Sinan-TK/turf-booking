/** Venue types as returned by the public GET /categories. */

export interface CategoryPolicy {
  slotIntervalMin: number;
  minDurationMin: number;
  maxDurationMin: number;
  durationIncrementMin: number;
  /** Every duration the type offers, ascending. */
  durations: number[];
}

export interface VenueCategory {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  /** What one bookable unit is called ("Table", "Pitch"…). */
  unitLabel: string;
  /** What a venue of this type is called ("Chess club", "Venue"…). */
  venueLabel: string;
  /** Allowed sub-types for filtering; empty = none. */
  unitTypes: string[];
  sortOrder: number;
  policy: CategoryPolicy;
}

/** 30 -> "30 min", 60 -> "1 hour", 90 -> "1 hr 30 min", 120 -> "2 hours". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** Compact suffix for a price: 60 -> "h", 120 -> "2h", 30 -> "30m". */
export function shortDuration(minutes: number): string {
  if (minutes === 60) return 'h';
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}
