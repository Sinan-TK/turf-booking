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
  iconSvg: true,
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
      // A fixed order, so "the next 10" always continues where the last page stopped.
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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

  async findCategoryIdsBySlugs(slugs: string[]) {
    const categories = await this.prisma.client.venueCategory.findMany({
      where: { slug: { in: slugs } },
      select: { id: true },
    });
    return categories.map((c) => c.id);
  }

  async findVenueIdsByGroundType(text: string) {
    const rows = await this.prisma.client.resource.findMany({
      where: { groundType: { contains: text, mode: 'insensitive' }, isBookable: true, status: 'ACTIVE' },
      select: { venueId: true },
      distinct: ['venueId'],
    });
    return rows.map((r) => r.venueId);
  }

  findBookableResources(venueId: string, groundType?: string, categoryIds?: string[]) {
    return this.prisma.client.resource.findMany({
      include: {
        category: { select: UNIT_CATEGORY_SELECT },
        // The unit's photos for the customer's card, main one first.
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { key: true } },
      },
      where: {
        venueId,
        ...(groundType ? { groundType } : {}),
        ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
        isBookable: true,
        status: 'ACTIVE',
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  findBookableGroups(venueId: string, categoryIds?: string[]) {
    return this.prisma.client.resourceGroup.findMany({
      include: {
        category: { select: UNIT_CATEGORY_SELECT },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { key: true } },
      },
      where: {
        venueId,
        allocationMode: 'POOLED',
        isBookable: true,
        totalUnits: { gt: 0 },
        ...(categoryIds ? { categoryId: { in: categoryIds } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
  }

  findPricingRulesForGroups(groupIds: string[], upTo: Date) {
    return this.prisma.client.pricingRule.findMany({
      where: { resourceGroupId: { in: groupIds }, isActive: true, effectiveFrom: { lte: upTo } },
    });
  }

  async findGroupReservations(groupIds: string[], from: Date, to: Date) {
    const rows = await this.prisma.client.inventoryReservation.findMany({
      where: { resourceGroupId: { in: groupIds }, status: { in: ['HELD', 'CONFIRMED'] }, startTime: { lt: to }, endTime: { gt: from } },
      select: { resourceGroupId: true, startTime: true, endTime: true, quantity: true },
    });
    return rows.map((r) => ({ ...r, resourceGroupId: r.resourceGroupId! }));
  }

  findGroupBlocks(groupIds: string[], from: Date, to: Date) {
    return this.prisma.client.blockedPeriod.findMany({
      where: { resourceGroupId: { in: groupIds }, startTime: { lt: to }, endTime: { gt: from } },
      select: { resourceGroupId: true, startTime: true, endTime: true },
    });
  }

  findPricingRules(resourceId: string, at: Date) {
    return this.prisma.client.pricingRule.findMany({
      where: { resourceId, isActive: true, effectiveFrom: { lte: at } },
    });
  }

  findPricingRulesForUnits(resourceIds: string[], upTo: Date) {
    return this.prisma.client.pricingRule.findMany({
      where: { resourceId: { in: resourceIds }, isActive: true, effectiveFrom: { lte: upTo } },
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
