import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AvailabilityRepository } from './availability.repository';

const VENUE_SEARCH_INCLUDE = {
  photos: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true } },
};

const UNIT_CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  iconKey: true,
  unitLabel: true,
  venueLabel: true,
  unitTypes: true,
} as const;

/**
 * Prisma-backed AvailabilityRepository. The ONLY file in the availability
 * module allowed to touch PrismaService. Query shapes are moved verbatim
 * from AvailabilityService.
 */
@Injectable()
export class PrismaAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findVenueByFacilityCode(facilityCode: string) {
    return this.prisma.client.venue.findUnique({
      where: { facilityCode },
      include: VENUE_SEARCH_INCLUDE,
    });
  }

  findActiveVenuesByDistrict(districtId: string) {
    return this.prisma.client.venue.findMany({
      where: { districtId, status: 'ACTIVE' },
      include: VENUE_SEARCH_INCLUDE,
    });
  }

  findActiveVenuesInBoundingBox(params: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
    return this.prisma.client.venue.findMany({
      where: {
        status: 'ACTIVE',
        lat: { gte: params.minLat, lte: params.maxLat },
        lng: { gte: params.minLng, lte: params.maxLng },
      },
      include: VENUE_SEARCH_INCLUDE,
    });
  }

  async findCategoryIdBySlug(slug: string) {
    const category = await this.prisma.client.venueCategory.findUnique({
      where: { slug },
      select: { id: true },
    });
    return category?.id ?? null;
  }

  findBookableResources(venueId: string, groundType?: string, categoryId?: string) {
    return this.prisma.client.resource.findMany({
      include: { category: { select: UNIT_CATEGORY_SELECT } },
      where: {
        venueId,
        ...(groundType ? { groundType } : {}),
        ...(categoryId ? { categoryId } : {}),
        isBookable: true,
        status: 'ACTIVE',
      },
    });
  }

  findPricingRules(resourceId: string, durationMinutes: number, at: Date) {
    return this.prisma.client.pricingRule.findMany({
      where: { resourceId, durationMinutes, isActive: true, effectiveFrom: { lte: at } },
    });
  }

  findOverlappingLocks(footprintIds: string[], rangeStart: Date, rangeEnd: Date) {
    return this.prisma.client.resourceLock.findMany({
      where: {
        resourceId: { in: footprintIds },
        status: { in: ['HELD', 'CONFIRMED'] },
        startTime: { lt: rangeEnd },
        endTime: { gt: rangeStart },
      },
    });
  }
}
