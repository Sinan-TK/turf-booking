import { Injectable } from '@nestjs/common';
import type { DayType } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import type { AvailabilityRepository } from './availability.repository';

const VENUE_SEARCH_INCLUDE = {
  photos: { orderBy: { sortOrder: 'asc' as const }, take: 1, select: { url: true } },
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
      iconKey: true,
      unitLabel: true,
      venueLabel: true,
      unitTypes: true,
    },
  },
};

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

  findBookableResources(venueId: string, groundType?: string) {
    return this.prisma.client.resource.findMany({
      where: {
        venueId,
        ...(groundType ? { groundType } : {}),
        isBookable: true,
        status: 'ACTIVE',
      },
    });
  }

  findPricingRule(resourceId: string, durationMinutes: number, dayType: string, now: Date) {
    return this.prisma.client.pricingRule.findFirst({
      where: {
        resourceId,
        durationMinutes,
        dayType: dayType as DayType,
        effectiveFrom: { lte: now },
      },
      orderBy: { effectiveFrom: 'desc' },
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
