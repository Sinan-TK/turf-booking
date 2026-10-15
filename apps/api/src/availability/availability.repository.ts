import type {
  PricingRule,
  Resource,
  ResourceLock,
  Venue,
} from '@venue/database';

/** Venue with its cover photo (first by sort order) and venue type for search cards. */
export type VenueWithPhoto = Venue & {
  photos: Array<{ url: string }>;
  category: {
    id: string;
    slug: string;
    name: string;
    iconKey: string;
    unitLabel: string;
    venueLabel: string;
    unitTypes: string[];
  };
};

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
  /** groundType omitted = every sub-type. */
  findBookableResources(venueId: string, groundType?: string): Promise<Resource[]>;
  findPricingRule(
    resourceId: string,
    durationMinutes: number,
    dayType: string,
    now: Date,
  ): Promise<PricingRule | null>;
  findOverlappingLocks(
    footprintIds: string[],
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ResourceLock[]>;
}

export const AVAILABILITY_REPOSITORY = Symbol('AVAILABILITY_REPOSITORY');
