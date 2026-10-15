import { z } from 'zod';
import { TimeWindow } from '../enums';
import { normalizeFacilityCode } from '../facility-code';

/**
 * Shared between apps/web (form validation) and apps/api (request DTO) so
 * the two never drift. "Preferred start-time window" per the brief — the
 * customer picks a window, not an exact time; the availability engine
 * computes valid start times inside it.
 */
export const locationFilterSchema = z.union([
  z.object({
    kind: z.literal('COORDINATES'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusKm: z.number().positive().max(100).default(10),
  }),
  z.object({
    kind: z.literal('VENUE_CODE'),
    // trim + uppercase applied here so callers never have to remember to
    // normalize before hitting the API (ARCHITECTURE.md's "Enter Venue
    // Code" flow step 1).
    venueCode: z.string().min(1).max(20).transform(normalizeFacilityCode),
  }),
  z.object({ kind: z.literal('SAVED_VENUE'), venueId: z.string().uuid() }),
  z.object({
    kind: z.literal('DISTRICT'),
    districtId: z.string().uuid(),
    areaId: z.string().uuid().optional(),
  }),
]);
export type LocationFilter = z.infer<typeof locationFilterSchema>;

export const searchRequestSchema = z.object({
  bookingSessionToken: z.string().min(16),
  groundType: z.string().min(1), // open string per ARCHITECTURE.md §5.2 (not hardcoded to 5s/7s)
  date: z.string().date(), // ISO date, resolved against the venue's timezone server-side
  timeWindow: z.nativeEnum(TimeWindow).optional(),
  durationMinutes: z.number().int().positive(),
  location: locationFilterSchema,
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;
