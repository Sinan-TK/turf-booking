import type {
  PricingRule,
  Resource,
  ResourceGroup,
  ResourceLock,
  Venue,
} from '@venue/database';

/** Venue with its cover photo (first by sort order) for search cards. */
export type VenueWithPhoto = Venue & {
  photos: Array<{ url: string }>;
};

/** The facility a bookable unit belongs to, as search cards show it. */
export interface UnitCategory {
  id: string;
  slug: string;
  name: string;
  iconKey: string;
  iconSvg: string | null;
  unitLabel: string;
  venueLabel: string;
  unitTypes: string[];
}

/** A unit with its facility and its photos (storage keys, main photo first). */
export type BookableResource = Resource & { category: UnitCategory; photos: Array<{ key: string }> };

/** A pooled group (a kayak fleet) with its facility, as search cards show it. */
export type BookableGroup = ResourceGroup & { category: UnitCategory; photos: Array<{ key: string }> };

/** Units of a pooled group held or confirmed for a time range. */
export interface GroupReservation {
  resourceGroupId: string;
  startTime: Date;
  endTime: Date;
  quantity: number;
}

/**
 * Clean-Architecture port: AvailabilityService (read-model use-case)
 * depends on this interface, never on Prisma directly.
 * PrismaAvailabilityRepository is the only file in this module allowed
 * to touch PrismaService. All methods are reads — the availability path
 * never writes (§6.5).
 */
export interface AvailabilityRepository {
  findVenueByFacilityCode(facilityCode: string): Promise<VenueWithPhoto | null>;
  findActiveVenuesByDistrict(districtId: string): Promise<VenueWithPhoto[]>;
  findActiveVenuesInBoundingBox(params: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }): Promise<VenueWithPhoto[]>;
  /** Ids of the venue types with these slugs (unknown slugs are simply missing from the answer). */
  findCategoryIdsBySlugs(slugs: string[]): Promise<string[]>;
  /** Ids of venues that have a bookable unit whose sub-type (e.g. "7S") contains the text, for the search box. */
  findVenueIdsByGroundType(text: string): Promise<string[]>;
  /** groundType omitted = every sub-type; categoryIds omitted = every facility. */
  findBookableResources(venueId: string, groundType?: string, categoryIds?: string[]): Promise<BookableResource[]>;
  /** Every rule for the unit and duration already in effect at `at`. */
  findPricingRules(resourceId: string, at: Date): Promise<PricingRule[]>;
  /** Every active price rule of all these units already in effect at `upTo`, in one read (search works a whole venue at once). */
  findPricingRulesForUnits(resourceIds: string[], upTo: Date): Promise<PricingRule[]>;
  /** The venue's open pooled groups (a count and a price are needed to book one); categoryIds omitted = every facility. */
  findBookableGroups(venueId: string, categoryIds?: string[]): Promise<BookableGroup[]>;
  /** Every active price rule of all these groups already in effect at `upTo`, in one read. */
  findPricingRulesForGroups(groupIds: string[], upTo: Date): Promise<PricingRule[]>;
  /** The units of these groups held or confirmed anywhere in [from, to). */
  findGroupReservations(groupIds: string[], from: Date, to: Date): Promise<GroupReservation[]>;
  /** The owner's blocked periods that are set on these groups, in [from, to). */
  findGroupBlocks(groupIds: string[], from: Date, to: Date): Promise<Array<{ resourceGroupId: string | null; startTime: Date; endTime: Date }>>;
  findOverlappingLocks(
    footprintIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ResourceLock[]>;
}

export const AVAILABILITY_REPOSITORY = Symbol('AVAILABILITY_REPOSITORY');
