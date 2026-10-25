import type {
  PricingRule,
  Resource,
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
  unitLabel: string;
  venueLabel: string;
  unitTypes: string[];
}

export type BookableResource = Resource & { category: UnitCategory };

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
  findCategoryIdBySlug(slug: string): Promise<string | null>;
  /** groundType omitted = every sub-type; categoryId omitted = every facility. */
  /** Ids of venues that have a bookable unit whose sub-type (e.g. "7S") contains the text, for the search box. */
  findVenueIdsByGroundType(text: string): Promise<string[]>;
  findBookableResources(venueId: string, groundType?: string, categoryId?: string): Promise<BookableResource[]>;
  /** Every rule for the unit and duration already in effect at `at`. */
  findPricingRules(resourceId: string, durationMinutes: number, at: Date): Promise<PricingRule[]>;
  findOverlappingLocks(
    footprintIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ResourceLock[]>;
}

export const AVAILABILITY_REPOSITORY = Symbol('AVAILABILITY_REPOSITORY');
