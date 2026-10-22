import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyResolverService } from '../scheduling/policy-resolver.service';
import { isDurationAllowed } from '../scheduling/policy-validation';
import { allowedDurations } from '../common/booking-policy.defaults';
import {
  describeRule,
  effectivePrice,
  legacyDayTypeToWeekdays,
  resolvePrices,
  rulesOverlap,
  withPrice,
} from '../pricing/pricing-rules';
import type { AuthContext } from '../auth/auth.types';
import type {
  CreateBlockedDateDto,
  CreatePricingRuleDto,
  UpdatePricingRuleDto,
} from './dto/venue-config.dto';

/**
 * Owner-facing "how bookable is my venue" configuration: pricing rules (which also
 * decide when a unit can be booked) and one-off blocked dates. Previously there
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
    venue: { id: string },
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
    const weekdays = dto.days
      ? [...new Set(dto.days)].sort((a, b) => a - b)
      : legacyDayTypeToWeekdays(dto.dayType!);
    if (weekdays.length === 0) throw new BadRequestException('Choose the days this price applies to');
    const prices = resolvePrices({
      normalPrice: (dto.normalPrice ?? dto.price)!,
      offerPrice: dto.offerPrice,
      bookingPrice: dto.bookingPrice,
    });
    const candidate = {
      resourceId: dto.resourceId ?? null,
      resourceGroupId: dto.resourceGroupId ?? null,
      durationMinutes: dto.durationMinutes,
      weekdays,
      startWindow: dto.startWindow ?? null,
      endWindow: dto.endWindow ?? null,
    };
    if (dto.resourceGroupId) {
      const group = await this.prisma.client.resourceGroup.findUnique({
        where: { id: dto.resourceGroupId },
      });
      if (!group) throw new NotFoundException('Resource group not found');
      const groupVenue = await this.assertVenueOwnership(group.venueId, actor);
      await this.assertDurationAllowed(groupVenue, { resourceGroupId: group.id }, dto.durationMinutes);
      await this.assertNoOverlap(candidate);
      const createdGroupRule = await this.prisma.client.pricingRule.create({
        data: {
          resourceId: null,
          resourceGroupId: dto.resourceGroupId,
          durationMinutes: dto.durationMinutes,
          weekdays,
          startWindow: dto.startWindow,
          endWindow: dto.endWindow,
          pricingMode: dto.pricingMode,
          ...prices,
          currency: dto.currency,
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        },
      });
      return withPrice(createdGroupRule);
    }
    const resource = await this.prisma.client.resource.findUnique({
      where: { id: dto.resourceId! },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    const resourceVenue = await this.assertVenueOwnership(resource.venueId, actor);
    await this.assertDurationAllowed(resourceVenue, { resourceId: resource.id }, dto.durationMinutes);
    await this.assertNoOverlap(candidate);

    const created = await this.prisma.client.pricingRule.create({
      data: {
        resourceId: dto.resourceId,
        durationMinutes: dto.durationMinutes,
        weekdays,
        startWindow: dto.startWindow,
        endWindow: dto.endWindow,
        ...prices,
        currency: dto.currency,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
      },
    });
    return withPrice(created);
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
    const rules = await this.prisma.client.pricingRule.findMany({
      where: {
        resourceId: resourceId ?? undefined,
        resourceGroupId: resourceGroupId ?? undefined,
        ...ownerScope,
      },
      orderBy: [{ durationMinutes: 'asc' }, { createdAt: 'desc' }],
    });
    return rules.map(withPrice);
  }

  /**
   * A price must not compete with another active price for the same unit and
   * duration: if some slot (day + start time) would be priced by both, it is
   * ambiguous which one applies, so the new/re-enabled price is refused and the
   * clashing one is named.
   */
  private async assertNoOverlap(
    candidate: {
      resourceId: string | null;
      resourceGroupId: string | null;
      durationMinutes: number;
      weekdays: number[];
      startWindow: string | null;
      endWindow: string | null;
    },
    excludeId?: string,
  ) {
    const existing = await this.prisma.client.pricingRule.findMany({
      where: {
        resourceId: candidate.resourceId,
        resourceGroupId: candidate.resourceGroupId,
        durationMinutes: candidate.durationMinutes,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    const probe = { ...candidate, effectiveFrom: new Date(), createdAt: new Date() };
    const clash = existing.find((rule) => rulesOverlap(probe, rule));
    if (clash) {
      throw new ConflictException(
        `This overlaps an existing price (${describeRule(clash)}). Block or remove that price first, or choose different days or hours.`,
      );
    }
  }

  /**
   * Edits one price: its days, hours, duration, amount, or whether it is blocked.
   * A price that is (or becomes) active is re-checked for overlaps, so editing or
   * unblocking can never leave two active prices competing for the same slot.
   */
  async updatePricingRule(id: string, dto: UpdatePricingRuleDto, actor: AuthContext) {
    const rule = await this.prisma.client.pricingRule.findUnique({
      where: { id },
      include: { resource: { select: { venueId: true } }, resourceGroup: { select: { venueId: true } } },
    });
    const venueId = rule?.resource?.venueId ?? rule?.resourceGroup?.venueId;
    if (!rule || !venueId) throw new NotFoundException('Price rule not found');
    const venue = await this.assertVenueOwnership(venueId, actor);

    const currentDays = rule.weekdays.length
      ? rule.weekdays
      : rule.dayType
        ? legacyDayTypeToWeekdays(rule.dayType)
        : [];
    const next = {
      resourceId: rule.resourceId,
      resourceGroupId: rule.resourceGroupId,
      durationMinutes: dto.durationMinutes ?? rule.durationMinutes,
      weekdays: dto.days ? [...new Set(dto.days)].sort((a, b) => a - b) : currentDays,
      startWindow: dto.startWindow === undefined ? rule.startWindow : dto.startWindow,
      endWindow: dto.endWindow === undefined ? rule.endWindow : dto.endWindow,
    };
    const isActive = dto.isActive ?? rule.isActive;
    // Re-validated only when a price field is sent. The booking price follows the full price while it was
    // equal to it (the old single-price behaviour); otherwise it stays unless sent.
    const touchesPrice =
      dto.normalPrice !== undefined ||
      dto.price !== undefined ||
      dto.offerPrice !== undefined ||
      dto.bookingPrice !== undefined;
    const oldFull = effectivePrice(rule);
    const prices = touchesPrice
      ? resolvePrices({
          normalPrice: dto.normalPrice ?? dto.price ?? Number(rule.normalPrice),
          offerPrice:
            dto.offerPrice === undefined ? (rule.offerPrice == null ? null : Number(rule.offerPrice)) : dto.offerPrice,
          bookingPrice: dto.bookingPrice ?? (Number(rule.bookingPrice) === oldFull ? undefined : Number(rule.bookingPrice)),
        })
      : undefined;
    if (next.weekdays.length === 0) throw new BadRequestException('Choose the days this price applies to');
    if (dto.durationMinutes !== undefined && dto.durationMinutes !== rule.durationMinutes) {
      await this.assertDurationAllowed(
        venue,
        rule.resourceId ? { resourceId: rule.resourceId } : { resourceGroupId: rule.resourceGroupId! },
        dto.durationMinutes,
      );
    }
    const changesCoverage =
      (isActive && !rule.isActive) ||
      next.durationMinutes !== rule.durationMinutes ||
      next.weekdays.join() !== currentDays.join() ||
      next.startWindow !== rule.startWindow ||
      next.endWindow !== rule.endWindow;
    if (isActive && changesCoverage) await this.assertNoOverlap(next, id);

    const { resource: _r, resourceGroup: _g, ...updated } = await this.prisma.client.pricingRule.update({
      where: { id },
      data: {
        isActive,
        durationMinutes: next.durationMinutes,
        weekdays: next.weekdays,
        startWindow: next.startWindow,
        endWindow: next.endWindow,
        ...(prices ?? {}),
      },
      include: { resource: { select: { venueId: true } }, resourceGroup: { select: { venueId: true } } },
    });
    return withPrice(updated);
  }

  /** Removes one price rule; the venue's owner (or a Super Admin) only. */
  async deletePricingRule(id: string, actor: AuthContext) {
    const rule = await this.prisma.client.pricingRule.findUnique({
      where: { id },
      include: { resource: { select: { venueId: true } }, resourceGroup: { select: { venueId: true } } },
    });
    if (!rule) throw new NotFoundException('Price rule not found');
    const venueId = rule.resource?.venueId ?? rule.resourceGroup?.venueId;
    if (!venueId) throw new NotFoundException('Price rule not found');
    await this.assertVenueOwnership(venueId, actor);
    await this.prisma.client.pricingRule.delete({ where: { id } });
    return { status: 'ok' };
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
