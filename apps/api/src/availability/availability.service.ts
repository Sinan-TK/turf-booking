import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { TIME_WINDOW_HOURS, normalizeFacilityCode } from '@venue/shared';
import type { CommercialTerms, TimeWindow } from '@venue/shared';
import { Prisma } from '@venue/database';
import { DateTime } from 'luxon';
import { atLeastMinAdvance, priceBooking } from '../pricing/pricing-rules';
import { CommercialTermsService } from '../commercial/commercial-terms.service';
import { ResourcesService } from '../resources/resources.service';
import { PolicyResolverService, type ResolvedPolicy } from '../scheduling/policy-resolver.service';
import { ScheduleService, type OpenWindow } from '../scheduling/schedule.service';
import { isDurationAllowed, lastBookableInstantMs } from '../scheduling/policy-validation';
import { allowedDurations } from '../common/booking-policy.defaults';
import { pLimit } from '../common/concurrency';
import { AVAILABILITY_REPOSITORY, type AvailabilityRepository } from './availability.repository';
import { StorageService } from '../storage/storage.service';

/** The response header that carries the cursor for the next page of search results. */
export const NEXT_CURSOR_HEADER = 'X-Next-Cursor';
/** How many days the day picker should offer: the largest "book up to n days ahead" of the venues in the search. */
export const ADVANCE_DAYS_HEADER = 'X-Advance-Days';

/** Venues worked on side by side, and the most database reads in flight at once for one search. */
const DEFAULT_ADVANCE_DAYS = 14;
const VENUE_CHUNK = 3;
const LOAD_CONCURRENCY = 8;

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
  /** Several venue types: a unit of any of them matches. Combined with the two above. */
  categorySlugs?: string[];
  date: string;
  timeWindow: TimeWindow;
  /** Omitted: each unit is shown at its own minimum booking length. */
  durationMinutes?: number;
  facilityCode?: string;
  districtId?: string;
  lat?: number;
  lng?: number;
  radiusKm: number;
  limit?: number;
  cursor?: string;
  q?: string;
}

type CandidateVenue = Awaited<ReturnType<AvailabilityRepository['findActiveVenuesByDistrict']>>[number];
type BookableResource = Awaited<ReturnType<AvailabilityRepository['findBookableResources']>>[number];
/** One search card, exactly as the API returns it. */
export interface SearchResult {
  venue: {
    id: string;
    name: string;
    facilityCode: string;
    address: string;
    photoUrl: string | null;
    lat: number;
    lng: number;
    googleMapsUrl: string | null;
  };
  category: BookableResource['category'];
  /** The length (minutes) the start times and prices are for. */
  durationMinutes: number;
  /** photoUrls: the unit's photos (at most three, main one first); empty when the owner has added none. */
  resource: { id: string; name: string; groundType: string; photoUrls: string[] };
  distanceKm: number | undefined;
  availableStartTimes: string[];
  policy: {
    slotIntervalMin: number;
    minDurationMin: number;
    maxDurationMin: number;
    durationIncrementMin: number;
    durations: number[];
  };
  openWindows: OpenWindow[] | null;
  timezone: string;
  price: { amount: string; currency: string; normalAmount: string | null; bookingAmount: string } | null;
  priceVaries: boolean;
  startPrices: Array<string | null>;
  startNormalPrices: Array<string | null>;
  startBookingPrices: Array<string | null>;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(AVAILABILITY_REPOSITORY) private readonly availability: AvailabilityRepository,
    private readonly resources: ResourcesService,
    private readonly policies: PolicyResolverService,
    private readonly schedule: ScheduleService,
    private readonly commercialTerms: CommercialTermsService,
    private readonly storage: StorageService,
  ) {}

  private async termsFor(venueId: string, categoryId: string, cache: Map<string, CommercialTerms>) {
    const key = `${venueId}:${categoryId}`;
    let terms = cache.get(key);
    if (!terms) {
      terms = (await this.commercialTerms.resolve(venueId, categoryId)).terms;
      cache.set(key, terms);
    }
    return terms;
  }

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
  /** Every result in one go (no paging): what a caller that wants the whole list uses. */
  async search(params: SearchParams) {
    return (await this.searchPage({ ...params, limit: undefined, cursor: undefined })).results;
  }

  /**
   * One page of results. With a `limit` of n, the page is n venues, each with all of its units that have open slots
   * (the answer is the flat list of those units), and `nextCursor` says which venue the next page starts at, or is
   * null when nothing is left. The order is fixed (nearest first for a location search, otherwise by venue name), so pages never
   * overlap or skip. The slow part is the database: each card needs a handful of reads, so those run side by
   * side (a few venues at a time, at most LOAD_CONCURRENCY reads in flight) instead of one after another.
   */
  async searchPage(params: SearchParams): Promise<{ results: SearchResult[]; nextCursor: string | null; advanceDays: number }> {
    const categoryIds = await this.resolveCategoryIds(params);
    // Asked for venue types, none of which exist: nothing can match.
    if (categoryIds && categoryIds.length === 0) return { results: [], nextCursor: null, advanceDays: DEFAULT_ADVANCE_DAYS };

    const candidates = await this.resolveCandidateVenues(params);
    // The day picker offers as many days as the venue that takes bookings furthest ahead (the text filter does not shrink it).
    const advanceDays = candidates.reduce((most, v) => Math.max(most, v.advanceBookingDays), 0) || DEFAULT_ADVANCE_DAYS;
    const needle = params.q?.trim().toLowerCase();
    // The text filter keeps venues whose name or address contains it, and venues with a unit of that sub-type
    // (the units themselves are narrowed again in resultsForVenue). Done here so a page never wades through
    // hundreds of venues that cannot match.
    let venues = candidates;
    if (needle) {
      const withSubType = new Set(await this.availability.findVenueIdsByGroundType(needle));
      venues = candidates.filter((v) => v.name.toLowerCase().includes(needle) || v.address.toLowerCase().includes(needle) || withSubType.has(v.id));
    }
    if (venues.length === 0) return { results: [], nextCursor: null, advanceDays };

    const [startVenue, startUnit] = params.cursor ? params.cursor.split('.').map(Number) : [0, 0];
    const now = new Date();
    const termsCache = new Map<string, CommercialTerms>();
    const limitReads = pLimit(LOAD_CONCURRENCY);
    const wanted = params.limit ?? Infinity;

    const results: SearchResult[] = [];
    let venuesShown = 0;
    let next: { venue: number; unit: number } | null = null;
    let v = startVenue!;
    let firstUnit = startUnit!;
    while (v < venues.length && venuesShown < wanted) {
      const chunk = venues.slice(v, v + VENUE_CHUNK);
      const perVenue = await Promise.all(
        chunk.map((venue, i) => this.resultsForVenue(venue, params, categoryIds, needle, now, termsCache, limitReads, i === 0 ? firstUnit : 0)),
      );
      let full = false;
      for (let i = 0; i < perVenue.length; i++) {
        const items = perVenue[i]!;
        if (items.length === 0) continue; // nothing open here: not a card
        if (venuesShown >= wanted) {
          // A page is whole venues, each with all its units, so the next page starts at the next venue.
          next = { venue: v + i, unit: 0 };
          full = true;
          break;
        }
        for (const item of items) results.push(item.result);
        venuesShown++;
      }
      if (full) break;
      v += chunk.length;
      firstUnit = 0;
    }
    if (!next && v < venues.length) next = { venue: v, unit: 0 };
    return { results, nextCursor: next ? `${next.venue}.${next.unit}` : null, advanceDays };
  }

  /** The venue types asked for (by id, slug or several slugs), or undefined when the search is not narrowed by type. */
  private async resolveCategoryIds(params: SearchParams): Promise<string[] | undefined> {
    const slugs = [...(params.categorySlug ? [params.categorySlug] : []), ...(params.categorySlugs ?? [])];
    if (!params.categoryId && slugs.length === 0) return undefined;
    const ids = slugs.length > 0 ? await this.availability.findCategoryIdsBySlugs(slugs) : [];
    return [...new Set([...(params.categoryId ? [params.categoryId] : []), ...ids])];
  }

  /** The cards one venue contributes, each tagged with its position among the venue's units (for the cursor). */
  private async resultsForVenue(
    venue: CandidateVenue,
    params: SearchParams,
    categoryIds: string[] | undefined,
    needle: string | undefined,
    now: Date,
    termsCache: Map<string, CommercialTerms>,
    limitReads: ReturnType<typeof pLimit>,
    fromUnit: number,
  ): Promise<Array<{ unitIndex: number; result: SearchResult }>> {
    const allResources = await limitReads(() => this.availability.findBookableResources(venue.id, params.groundType, categoryIds));
    // A text filter keeps a venue's units when the venue's name or address matches, else only units whose sub-type does.
    const venueMatches = !needle || venue.name.toLowerCase().includes(needle) || venue.address.toLowerCase().includes(needle);
    const resources = venueMatches ? allResources : allResources.filter((r) => r.groundType.toLowerCase().includes(needle!));
    if (resources.length === 0 || fromUnit >= resources.length) return [];
    const policySet = await limitReads(() => this.policies.forVenue(venue, now));

    // Resolved per-venue, in that venue's own timezone — candidate venues from a geo/district search can
    // legitimately span timezones on a global platform, and "today"/weekday must mean the venue's local
    // calendar day, not the server's (engineering rule #11).
    const { start: windowStart, end: windowEnd, localDay } = this.resolveWindow(params.date, params.timeWindow, venue.timezone);

    const built = await Promise.all(
      resources.map(async (resource, unitIndex) => {
        if (unitIndex < fromUnit) return null;
        const result = await this.resultForResource(
          venue,
          resource,
          policySet.resolve({ resourceId: resource.id }),
          params,
          { windowStart, windowEnd, localDay },
          now,
          termsCache,
          limitReads,
        );
        return result ? { unitIndex, result } : null;
      }),
    );
    return built.filter((b): b is { unitIndex: number; result: SearchResult } => b !== null);
  }

  /** One card: the open start times for a unit on the day, priced. A unit with none left (all booked, or the time has passed) is still returned, with no start times and no price, so the site can show it greyed out. */
  private async resultForResource(
    venue: CandidateVenue,
    resource: BookableResource,
    policy: ResolvedPolicy,
    params: SearchParams,
    day: { windowStart: Date; windowEnd: Date; localDay: DateTime },
    now: Date,
    termsCache: Map<string, CommercialTerms>,
    limitReads: ReturnType<typeof pLimit>,
  ): Promise<SearchResult | null> {
    // Each unit has its own shortest and longest booking. The requested length is used where the unit offers it; otherwise
    // (no length asked for, or one this unit does not offer, e.g. 90 minutes for a unit booked in 60-minute blocks) the unit
    // is shown at its own shortest, and says so in `durationMinutes`.
    const durationMinutes =
      params.durationMinutes !== undefined && isDurationAllowed(policy, params.durationMinutes) ? params.durationMinutes : policy.minDurationMin;

    const openWindows = await limitReads(() => this.schedule.openWindows({ resourceId: resource.id }, day.localDay, durationMinutes));
    const startTimes = await limitReads(() =>
      this.candidateStartTimes({
        venueId: venue.id,
        resourceId: resource.id,
        policy,
        durationMinutes,
        windowStart: day.windowStart,
        windowEnd: day.windowEnd,
        openWindows,
        timezone: venue.timezone,
        now,
        advanceDays: venue.advanceBookingDays,
      }),
    );
    // Nothing to book: when the unit is open that day and the day can be booked, it is kept in the list (all booked, or the time has
    // passed) and the site greys it out. A closed day, or a day beyond how far ahead the venue takes bookings, is not listed at all.
    if (startTimes.length === 0) {
      const closedThatDay = openWindows !== null && openWindows.length === 0;
      const beyondWindow =
        day.windowStart.getTime() > Math.min(now.getTime() + policy.maxAdvanceDays * 86_400_000, lastBookableInstantMs(now, venue.timezone, venue.advanceBookingDays));
      if (closedThatDay || beyondWindow) return null;
    }

    // The price depends on the day AND the time each block starts, so each start time is priced on its own (the sum of
    // its blocks); `price` is the lowest of them.
    const blockMinutes = policy.minDurationMin;
    const latestStart = startTimes.length > 0 ? startTimes.reduce((a, b) => (a > b ? a : b)) : null;
    const lastBlockStart = latestStart ? new Date(latestStart.getTime() + (durationMinutes - blockMinutes) * MINUTE_MS) : null;
    const [pricingRules, terms] = await Promise.all([
      lastBlockStart ? limitReads(() => this.availability.findPricingRules(resource.id, lastBlockStart)) : Promise.resolve([]),
      limitReads(() => this.termsFor(venue.id, resource.categoryId, termsCache)),
    ]);
    const startPrices = startTimes.map((t) => priceBooking(pricingRules, t, durationMinutes, blockMinutes, venue.timezone));
    const priced = startPrices.filter((r): r is NonNullable<typeof r> => r !== null);
    const pricingRule = priced.reduce<(typeof priced)[number] | null>((low, r) => (low === null || r.amount < low.amount ? r : low), null);
    const priceVaries = new Set(startPrices.map((r) => (r ? r.amount : null))).size > 1;
    // The advance shown is what a hold will charge: never below the facility's minimum.
    const advanceOf = (r: NonNullable<(typeof startPrices)[number]>) =>
      atLeastMinAdvance(new Prisma.Decimal(r.advance), new Prisma.Decimal(r.amount), terms).toString();
    // The struck-through normal price, only when an offer makes the booking cheaper than it.
    const normalOf = (r: NonNullable<(typeof startPrices)[number]>) => (r.normalAmount > r.amount ? String(r.normalAmount) : null);

    return {
      venue: {
        id: venue.id,
        name: venue.name,
        facilityCode: venue.facilityCode,
        address: venue.address,
        photoUrl: venue.photos[0]?.url ?? null,
        lat: Number(venue.lat),
        lng: Number(venue.lng),
        googleMapsUrl: venue.googleMapsUrl,
      },
      category: resource.category,
      resource: {
        id: resource.id,
        name: resource.name,
        groundType: resource.groundType,
        photoUrls: resource.photos.map((p) => this.storage.publicUrl(p.key)),
      },
      distanceKm:
        params.lat !== undefined && params.lng !== undefined
          ? Number(haversineKm(params.lat, params.lng, Number(venue.lat), Number(venue.lng)).toFixed(2))
          : undefined,
      // The length the start times and prices are for (the requested one where this unit offers it, else its shortest).
      durationMinutes,
      availableStartTimes: startTimes.map((t) => t.toISOString()),
      // What the UI needs to render durations and the slot grid without hardcoding anything per venue type.
      policy: {
        slotIntervalMin: policy.slotIntervalMin,
        minDurationMin: policy.minDurationMin,
        maxDurationMin: policy.maxDurationMin,
        durationIncrementMin: policy.durationIncrementMin,
        durations: allowedDurations(policy),
      },
      openWindows: openWindows ?? null,
      timezone: venue.timezone,
      // `amount` is the full price (the offer when there is one). `normalAmount` is the struck-through normal price
      // (only when an offer applies) and `bookingAmount` is the advance paid online.
      price: pricingRule
        ? {
            amount: String(pricingRule.amount),
            currency: pricingRule.currency,
            normalAmount: normalOf(pricingRule),
            bookingAmount: advanceOf(pricingRule),
          }
        : null,
      // True when different start times cost different amounts, so the UI can say "from".
      priceVaries,
      // Aligned with availableStartTimes; null where no price rule covers that time.
      startPrices: startPrices.map((r) => (r ? String(r.amount) : null)),
      startNormalPrices: startPrices.map((r) => (r ? normalOf(r) : null)),
      startBookingPrices: startPrices.map((r) => (r ? advanceOf(r) : null)),
    };
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
    return nearby
      .map((t) => ({ t, km: haversineKm(params.lat!, params.lng!, Number(t.lat), Number(t.lng)) }))
      .filter(({ km }) => km <= params.radiusKm)
      // Nearest first, with the id as a tiebreak so the order never changes between two requests.
      .sort((x, y) => x.km - y.km || x.t.id.localeCompare(y.t.id))
      .map(({ t }) => t);
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
    /** The venue's own "book up to n days ahead", counted on its calendar (today is day one). */
    advanceDays: number;
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
    // The nearer of the facility's general limit and the venue's own "book up to n days ahead".
    const latestStart = Math.min(now.getTime() + policy.maxAdvanceDays * 86_400_000, lastBookableInstantMs(now, timezone, args.advanceDays));

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
