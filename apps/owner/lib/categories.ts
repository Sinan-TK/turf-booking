/** Venue types (Super-Admin managed). Mirrors GET /categories and /admin/categories. */

export interface CategoryPolicy {
  slotIntervalMin: number;
  minDurationMin: number;
  maxDurationMin: number;
  durationIncrementMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  maxAdvanceDays: number;
  minLeadMinutes: number;
  /** Every duration the policy offers, ascending. */
  durations: number[];
}

export interface VenueCategory {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  unitLabel: string;
  venueLabel: string;
  /** Allowed resource sub-types; empty = free text. */
  unitTypes: string[];
  defaultAllocationMode: 'EXCLUSIVE' | 'POOLED';
  sortOrder: number;
  isActive: boolean;
  policy: CategoryPolicy;
}

export interface AdminVenueCategory extends VenueCategory {
  /** Venues (any status) using this type. */
  venueCount: number;
}

/** The slice of a category every venue response carries. */
export interface VenueCategorySummary {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  unitLabel: string;
  venueLabel: string;
  unitTypes: string[];
  defaultAllocationMode: 'EXCLUSIVE' | 'POOLED';
}

/** 30 -> "30 min", 60 -> "1 hour", 90 -> "1 hr 30 min", 120 -> "2 hours". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} hr ${m} min`;
}
