import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TIME_WINDOW_HOURS, normalizeFacilityCode } from '@venue/shared';
import type { TimeWindow } from '@venue/shared';
import { DateTime } from 'luxon';
import { ResourcesService } from '../resources/resources.service';
import { PolicyResolverService, type ResolvedPolicy } from '../scheduling/policy-resolver.service';
import { ScheduleService, type OpenWindow } from '../scheduling/schedule.service';
import { isDurationAllowed } from '../scheduling/policy-validation';
import { allowedDurations } from '../common/booking-policy.defaults';
import { AVAILABILITY_REPOSITORY, type AvailabilityRepository } from './availability.repository';

const EARTH_RADIUS_KM = 6371;
const MINUTE_MS = 60_000;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface SearchParams {
  /** Optional sub-type filter (Resource.groundType). Omitted = every type. */
  groundType?: string;
  /** Optional venue-type filters. Omitted = every active venue type. */
  categoryId?: string;
  categorySlug?: string;
  date: string;
  timeWindow: TimeWindow;
  durationMinutes: number;
  facilityCode?: string;
  districtId?: string;
  lat?: number;
  lng?: number;
  radiusKm: number;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(AVAILABILITY_REPOSITORY) private readonly availability: AvailabilityRepository,
    private readonly resources: ResourcesService,
    private readonly policies: PolicyResolverService,
    private readonly schedule: ScheduleService,
  ) {}

  /**
   * Read-path only (ARCHITECTURE.md §6.5) — never touches ResourceLock's
   * exclusion constraint, just queries around it. Must expand each
   * candidate resource to its own footprint (ResourcesService
   * .getFootprintResourceIds) and check locks across that whole set —
   * checking only the candidate's own resourceId would miss e.g. "5s A is
   * booked" when checking whether 7s Full is available, since a 5s A
   * booking only locks the 5s A leaf, not 7s Full directly (§6.1/§6.3).
   *
   * Slot generation is driven by each resource's resolved BookingPolicy
   * (interval, durations, buffers, lead time, advance window) — the same
   * rules BookingsService enforces on holds.
   */
  async search(params: SearchParams) {
    let categoryId = params.categoryId;
    if (!categoryId && params.categorySlug) {
      categoryId = (await this.availability.findCategoryIdBySlug(params.categorySlug)) ?? undefined;
      if (!categoryId) return [];
    }

    const candidateVenues = (await this.resolveCandidateVenues(params)).filter(
      (venue) => !categoryId || venue.categoryId === categoryId,
    );
    if (candidateVenues.length === 0) return [];

    const now = new Date();
    const results = [];
    for (const venue of candidateVenues) {
      const resources = await this.availability.findBookableResources(venue.id, params.groundType);
      if (resources.length === 0) continue;
      const policySet = await this.policies.forVenue(venue, now);

      // Resolved per-venue, in that venue's own timezone — candidate venues
      // from a geo/district search can legitimately span timezones on a
      // global platform, and "today"/weekday must mean the venue's local
      // calendar day, not the server's (engineering rule #11).
      const {
        start: windowStart,
        end: windowEnd,
        localDay,
        localWeekday,
      } = this.resolveWindow(params.date, params.timeWindow, venue.timezone);

      for (const resource of resources) {
        const policy = policySet.resolve({ resourceId: resource.id });
        // A resource whose policy doesn't offer this duration simply has
        // nothing to show for it (e.g. a 30-min request vs a 60-min venue).
        if (!isDurationAllowed(policy, params.durationMinutes)) continue;

        const openWindows = await this.schedule.openWindows(
          venue.id,
          { resourceId: resource.id },
          localDay,
        );
        const startTimes = await this.candidateStartTimes({
          venueId: venue.id,
          resourceId: resource.id,
          policy,
          durationMinutes: params.durationMinutes,
          windowStart,
          windowEnd,
          openWindows,
          timezone: venue.timezone,
          now,
        });
        if (startTimes.length === 0) continue;

        const pricingRule = await this.availability.findPricingRule(
          resource.id,
          params.durationMinutes,
          localWeekday === 0 || localWeekday === 6 ? 'WEEKEND' : 'WEEKDAY',
          new Date(),
        );

        results.push({
          venue: {
            id: venue.id,
            name: venue.name,
            facilityCode: venue.facilityCode,
            address: venue.address,
            photoUrl: venue.photos[0]?.url ?? null,
            lat: Number(venue.lat),
            lng: Number(venue.lng),
          },
          category: venue.category,
          resource: { id: resource.id, name: resource.name, groundType: resource.groundType },
          distanceKm:
            params.lat !== undefined && params.lng !== undefined
              ? Number(
                  haversineKm(params.lat, params.lng, Number(venue.lat), Number(venue.lng)).toFixed(
                    2,
                  ),
                )
              : undefined,
          availableStartTimes: startTimes.map((t) => t.toISOString()),
          // What the UI needs to render durations and the slot grid
          // without hardcoding anything per venue type.
          policy: {
            slotIntervalMin: policy.slotIntervalMin,
            minDurationMin: policy.minDurationMin,
            maxDurationMin: policy.maxDurationMin,
            durationIncrementMin: policy.durationIncrementMin,
            durations: allowedDurations(policy),
          },
          openWindows: openWindows ?? null,
          timezone: venue.timezone,
          price: pricingRule
            ? { amount: pricingRule.price.toString(), currency: pricingRule.currency }
            : null,
        });
      }
    }
    return results;
  }

  private async resolveCandidateVenues(params: SearchParams) {
    if (params.facilityCode) {
      const venue = await this.availability.findVenueByFacilityCode(
        normalizeFacilityCode(params.facilityCode),
      );
      if (!venue || venue.status !== 'ACTIVE') throw new NotFoundException('Facility not found');
      return [venue];
    }
    if (params.districtId) {
      return this.availability.findActiveVenuesByDistrict(params.districtId);
    }
    // Geo search: coarse bounding box in SQL (cheap, index-friendly),
    // exact haversine filter in JS after. Fine at the scale a single
    // district/city search returns; would move to PostGIS at real scale.
    const latDelta = params.radiusKm / 111; // ~111km per degree latitude
    const lngDelta = params.radiusKm / (111 * Math.cos((params.lat! * Math.PI) / 180));
    const nearby = await this.availability.findActiveVenuesInBoundingBox({
      minLat: params.lat! - latDelta,
      maxLat: params.lat! + latDelta,
      minLng: params.lng! - lngDelta,
      maxLng: params.lng! + lngDelta,
    });
    return nearby.filter(
      (t) => haversineKm(params.lat!, params.lng!, Number(t.lat), Number(t.lng)) <= params.radiusKm,
    );
  }

  /**
   * Interprets `dateStr` ("2026-09-26") as a calendar date in the VENUE's
   * timezone, not the server's — the resulting start/end are absolute UTC
   * instants, and `localWeekday` is in the same 0=Sunday..6=Saturday
   * convention as OperatingHours.weekday (luxon's own `.weekday` is
   * ISO 1=Monday..7=Sunday, converted here so nothing downstream has to
   * know luxon's convention exists).
   */
  private resolveWindow(dateStr: string, timeWindow: TimeWindow, venueTimezone: string) {
    const { startHour, endHour } = TIME_WINDOW_HOURS[timeWindow];
    const localDate = DateTime.fromISO(dateStr, { zone: venueTimezone }).set({
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    // luxon's set() doesn't overflow hour:24 the way JS Date does, so the
    // EVENING window's endHour (24, i.e. midnight of the next day) is
    // built by adding hours to local midnight instead.
    const start = localDate.plus({ hours: startHour });
    const end = localDate.plus({ hours: endHour });
    return {
      start: start.toJSDate(),
      end: end.toJSDate(),
      localDay: localDate,
      localWeekday: localDate.weekday % 7,
    };
  }

  /**
   * Start times for one resource on one day. A start is offered when it:
   * sits on the policy's slot grid (venue-local midnight + k*interval),
   * lies inside an opening window together with the whole duration,
   * respects the lead-time / advance-booking limits, is not blocked, and —
   * once the policy's buffers are added on both sides — does not overlap
   * an existing lock. Locks are stored buffer-padded (BookingsService), so
   * padding the candidate the same way means the required gap between two
   * bookings is `previous.bufferAfter + next.bufferBefore`.
   */
  private async candidateStartTimes(args: {
    venueId: string;
    resourceId: string;
    policy: ResolvedPolicy;
    durationMinutes: number;
    windowStart: Date;
    windowEnd: Date;
    openWindows: OpenWindow[] | null;
    timezone: string;
    now: Date;
  }): Promise<Date[]> {
    const { policy, durationMinutes, windowStart, windowEnd, openWindows, timezone, now } = args;
    const durationMs = durationMinutes * MINUTE_MS;
    const intervalMs = policy.slotIntervalMin * MINUTE_MS;
    const padBeforeMs = policy.bufferBeforeMin * MINUTE_MS;
    const padAfterMs = policy.bufferAfterMin * MINUTE_MS;

    const localMidnight = DateTime.fromJSDate(windowStart, { zone: timezone }).startOf('day');
    const bounds = (
      openWindows === null
        ? [{ from: windowStart, to: windowEnd }]
        : openWindows.map((w) => ({
            from: new Date(
              Math.max(windowStart.getTime(), this.schedule.at(localMidnight, w.openTime).getTime()),
            ),
            to: new Date(
              Math.min(windowEnd.getTime(), this.schedule.at(localMidnight, w.closeTime).getTime()),
            ),
          }))
    ).filter((b) => b.to.getTime() - b.from.getTime() >= durationMs);
    if (bounds.length === 0) return [];

    const earliestStart = now.getTime() + policy.minLeadMinutes * MINUTE_MS;
    const latestStart = now.getTime() + policy.maxAdvanceDays * 86_400_000;

    const rangeStart = new Date(Math.min(...bounds.map((b) => b.from.getTime())));
    const rangeEnd = new Date(Math.max(...bounds.map((b) => b.to.getTime())));

    const footprintIds = await this.resources.getFootprintResourceIds(args.resourceId);
    const existingLocks = await this.availability.findOverlappingLocks(
      footprintIds,
      new Date(rangeStart.getTime() - padBeforeMs),
      new Date(rangeEnd.getTime() + padAfterMs),
    );
    // Owner-configured blackouts: venue-wide blocks apply to every
    // resource; resource-specific blocks only to that resource's own
    // footprint (blocking a 5s half doesn't block the 7s full ground it
    // composes — a documented scope limit, not an oversight). Blackouts
    // are not buffer-padded.
    const blocks = await this.schedule.findBlocks(args.venueId, { footprintIds }, rangeStart, rangeEnd);

    const midnightMs = localMidnight.toMillis();
    const candidates = new Map<number, Date>();
    for (const bound of bounds) {
      // First grid point at or after the bound's start.
      const sinceMidnight = bound.from.getTime() - midnightMs;
      let t = midnightMs + Math.ceil(sinceMidnight / intervalMs) * intervalMs;
      for (; t + durationMs <= bound.to.getTime(); t += intervalMs) {
        if (t < earliestStart || t > latestStart) continue;
        const slotEnd = t + durationMs;
        const paddedStart = t - padBeforeMs;
        const paddedEnd = slotEnd + padAfterMs;
        const lockOverlap = existingLocks.some(
          (lock) => lock.startTime.getTime() < paddedEnd && lock.endTime.getTime() > paddedStart,
        );
        const blockOverlap = blocks.some(
          (b) => b.startTime.getTime() < slotEnd && b.endTime.getTime() > t,
        );
        if (!lockOverlap && !blockOverlap) candidates.set(t, new Date(t));
      }
    }
    return [...candidates.entries()].sort(([a], [b]) => a - b).map(([, d]) => d);
  }
}
