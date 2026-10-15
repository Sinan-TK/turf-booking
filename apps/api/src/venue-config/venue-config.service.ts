import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyResolverService } from '../scheduling/policy-resolver.service';
import { isDurationAllowed } from '../scheduling/policy-validation';
import { allowedDurations } from '../common/booking-policy.defaults';
import type { AuthContext } from '../auth/auth.types';
import type {
  CreateBlockedDateDto,
  CreatePricingRuleDto,
  UpsertOperatingHoursDto,
} from './dto/venue-config.dto';

/**
 * Owner-facing "how bookable is my venue" configuration: pricing rules,
 * weekly operating hours, and one-off blocked dates. Previously there
 * was no API for any of this — the pricing rules the Phase 5-8 booking
 * tests relied on were inserted directly via psql, which is obviously
 * not something a real Venue Owner can do. Mirrors ResourcesService's
 * ownership-check pattern: every mutation re-derives and checks the
 * owning venue itself rather than trusting a caller-supplied org id
 * (ARCHITECTURE.md §12).
 */
@Injectable()
export class VenueConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: PolicyResolverService,
  ) {}

  private async assertVenueOwnership(venueId: string, actor: AuthContext) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');
    if (actor.role === 'VENUE_OWNER' && venue.organizationId !== actor.organizationId) {
      throw new ForbiddenException("Cannot manage another organization's venue");
    }
    return venue;
  }

  /** A price rule only makes sense for a duration the venue's policy offers. */
  private async assertDurationAllowed(
    venue: { id: string; categoryId: string },
    target: { resourceId?: string; resourceGroupId?: string },
    durationMinutes: number,
  ) {
    const policy = (await this.policies.forVenue(venue)).resolve(target);
    if (!isDurationAllowed(policy, durationMinutes)) {
      throw new BadRequestException(
        `Duration ${durationMinutes} is not offered by this venue type (allowed: ${allowedDurations(policy).join(', ')})`,
      );
    }
  }

  // --- Pricing rules ---------------------------------------------------

  async createPricingRule(dto: CreatePricingRuleDto, actor: AuthContext) {
    // Exactly-one target is enforced by the Zod DTO at the HTTP
    // boundary; re-checked here because services are also reachable
    // through non-HTTP paths in tests.
    if (!!dto.resourceId === !!dto.resourceGroupId) {
      throw new BadRequestException('Exactly one of resourceId, resourceGroupId is required');
    }
    if (dto.resourceGroupId) {
      const group = await this.prisma.client.resourceGroup.findUnique({
        where: { id: dto.resourceGroupId },
      });
      if (!group) throw new NotFoundException('Resource group not found');
      const groupVenue = await this.assertVenueOwnership(group.venueId, actor);
      await this.assertDurationAllowed(groupVenue, { resourceGroupId: group.id }, dto.durationMinutes);
      return this.prisma.client.pricingRule.create({
        data: {
          resourceId: null,
          resourceGroupId: dto.resourceGroupId,
          durationMinutes: dto.durationMinutes,
          dayType: dto.dayType,
          startWindow: dto.startWindow,
          endWindow: dto.endWindow,
          pricingMode: dto.pricingMode,
          price: dto.price,
          currency: dto.currency,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        },
      });
    }
    const resource = await this.prisma.client.resource.findUnique({
      where: { id: dto.resourceId! },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    const resourceVenue = await this.assertVenueOwnership(resource.venueId, actor);
    await this.assertDurationAllowed(resourceVenue, { resourceId: resource.id }, dto.durationMinutes);

    return this.prisma.client.pricingRule.create({
      data: {
        resourceId: dto.resourceId,
        durationMinutes: dto.durationMinutes,
        dayType: dto.dayType,
        startWindow: dto.startWindow,
        endWindow: dto.endWindow,
        price: dto.price,
        currency: dto.currency,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
      },
    });
  }

  async listPricingRules(actor: AuthContext, resourceId?: string, resourceGroupId?: string) {
    // Reads are tenant-scoped like writes: an owner can only list rules of
    // their own organization's resources/groups.
    if (resourceId) {
      const resource = await this.prisma.client.resource.findUnique({ where: { id: resourceId } });
      if (!resource) throw new NotFoundException('Resource not found');
      await this.assertVenueOwnership(resource.venueId, actor);
    }
    if (resourceGroupId) {
      const group = await this.prisma.client.resourceGroup.findUnique({ where: { id: resourceGroupId } });
      if (!group) throw new NotFoundException('Resource group not found');
      await this.assertVenueOwnership(group.venueId, actor);
    }
    const ownerScope =
      !resourceId && !resourceGroupId && actor.role === 'VENUE_OWNER'
        ? {
            OR: [
              { resource: { venue: { organizationId: actor.organizationId } } },
              { resourceGroup: { venue: { organizationId: actor.organizationId } } },
            ],
          }
        : {};
    return this.prisma.client.pricingRule.findMany({
      where: {
        resourceId: resourceId ?? undefined,
        resourceGroupId: resourceGroupId ?? undefined,
        ...ownerScope,
      },
      orderBy: [{ dayType: 'asc' }, { durationMinutes: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  // --- Operating hours ---------------------------------------------------

  async upsertOperatingHours(dto: UpsertOperatingHoursDto, actor: AuthContext) {
    await this.assertVenueOwnership(dto.venueId, actor);
    // Dual-write: the legacy OperatingHours row (rollback source) and its
    // AvailabilityRule twin (keyed by sourceOperatingHoursId, so a repeat
    // call updates rather than duplicates) commit together.
    return this.prisma.client.$transaction(async (tx) => {
      const hours = await tx.operatingHours.upsert({
        where: { venueId_weekday: { venueId: dto.venueId, weekday: dto.weekday } },
        create: dto,
        update: { openTime: dto.openTime, closeTime: dto.closeTime },
      });
      await tx.availabilityRule.upsert({
        where: { sourceOperatingHoursId: hours.id },
        create: {
          venueId: hours.venueId,
          weekday: hours.weekday,
          openTime: hours.openTime,
          closeTime: hours.closeTime,
          sourceOperatingHoursId: hours.id,
        },
        update: { weekday: hours.weekday, openTime: hours.openTime, closeTime: hours.closeTime },
      });
      return hours;
    });
  }

  async listOperatingHours(venueId: string, actor: AuthContext) {
    await this.assertVenueOwnership(venueId, actor);
    return this.prisma.client.operatingHours.findMany({
      where: { venueId },
      orderBy: { weekday: 'asc' },
    });
  }

  // --- Blocked dates ---------------------------------------------------

  async createBlockedDate(dto: CreateBlockedDateDto, actor: AuthContext) {
    await this.assertVenueOwnership(dto.venueId, actor);
    const data = {
      venueId: dto.venueId,
      resourceId: dto.resourceId,
      startTime: new Date(dto.startTime),
      endTime: new Date(dto.endTime),
      reason: dto.reason,
      createdByOwnerUserId: actor.role === 'VENUE_OWNER' ? actor.id : undefined,
    };
    // Dual-write: legacy BlockedDate + its BlockedPeriod twin (linked by
    // sourceBlockedDateId) in one transaction.
    return this.prisma.client.$transaction(async (tx) => {
      const blocked = await tx.blockedDate.create({ data });
      await tx.blockedPeriod.create({ data: { ...data, sourceBlockedDateId: blocked.id } });
      return blocked;
    });
  }

  async listBlockedDates(venueId: string, actor: AuthContext) {
    await this.assertVenueOwnership(venueId, actor);
    return this.prisma.client.blockedDate.findMany({
      where: { venueId },
      orderBy: { startTime: 'desc' },
    });
  }

  async deleteBlockedDate(id: string, actor: AuthContext) {
    const blocked = await this.prisma.client.blockedDate.findUnique({ where: { id } });
    if (!blocked) throw new NotFoundException('Blocked date not found');
    await this.assertVenueOwnership(blocked.venueId, actor);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.blockedPeriod.deleteMany({ where: { sourceBlockedDateId: id } });
      await tx.blockedDate.delete({ where: { id } });
    });
    return { status: 'ok' };
  }
}
