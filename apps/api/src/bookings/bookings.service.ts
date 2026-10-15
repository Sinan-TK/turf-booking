import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BOOKING_TRANSITIONS,
  assertTransition,
} from '@venue/shared';
import { loadEnv } from '@venue/config';
import { Prisma } from '@venue/database';
import { DateTime } from 'luxon';
import { ResourcesService } from '../resources/resources.service';
import { BOOKINGS_REPOSITORY, type BookingsRepository } from './bookings.repository';
import { PoliciesService } from '../policies/policies.service';
import { AuditService } from '../audit/audit.service';
import { CoinsService } from '../coins/coins.service';
import { WhatsAppClientService } from '../whatsapp/whatsapp-client.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateOfflineBookingDto } from './dto/booking.dto';
import { PolicyResolverService } from '../scheduling/policy-resolver.service';
import { ScheduleService } from '../scheduling/schedule.service';
import { assertPolicyAllowsBooking, paddedRange } from '../scheduling/policy-validation';

// Postgres SQLSTATEs that mean "the exclusion constraint on
// resource_locks rejected this — the slot is genuinely taken," verified
// against a live server (both in the Phase 2 raw-SQL test and, harder,
// through this exact code path — see the Phase 5 notes in
// ARCHITECTURE.md): a straightforward exclusion violation, and the
// deadlock the database's own deadlock detector can report when two
// holds race to lock overlapping resource sets at the same moment. Both
// must map to the same friendly response — treating only one as
// "conflict" would surface the other as an unhandled 500. Matched by
// plain substring rather than a hand-rolled regex against Prisma's error
// formatting, which turned out to not match "code: "23P01"" at all on
// the first attempt — a regex that *looks* plausible but was never
// actually exercised against a real error is exactly the kind of bug
// this substring check is simple enough to not have.
const SLOT_CONFLICT_SQLSTATES = ['23P01', '40P01'];

function isSlotConflictError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientUnknownRequestError ||
    error instanceof Prisma.PrismaClientKnownRequestError
  ) {
    return SLOT_CONFLICT_SQLSTATES.some((code) => error.message.includes(code));
  }
  return false;
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(BOOKINGS_REPOSITORY) private readonly bookings: BookingsRepository,
    private readonly resources: ResourcesService,
    private readonly policies: PoliciesService,
    private readonly audit: AuditService,
    private readonly coins: CoinsService,
    private readonly whatsapp: WhatsAppClientService,
    private readonly customers: CustomersService,
    private readonly notifications: NotificationsService,
    private readonly policyResolver: PolicyResolverService,
    private readonly schedule: ScheduleService,
  ) {}

  /**
   * The critical path (ARCHITECTURE.md §6.3, §8): materializes a
   * ResourceLock row for every resource in footprint(resourceId) — the
   * leaf resources it physically occupies, not its whole ancestor chain
   * (see ResourcesService.getFootprintResourceIds for why) — which is
   * what the GiST exclusion constraint actually guards. If two callers
   * race for overlapping resources, the database — not this code —
   * decides which one wins; the loser gets a clean 409 here instead of
   * an unhandled 500.
   */
  async createHold(
    dto: {
      resourceId?: string;
      resourceGroupId?: string;
      quantity?: number;
      startTime: string;
      durationMinutes: number;
    },
    actor: AuthContext,
  ) {
    // Exactly-one inventory target: the Zod DTO enforces this at the
    // HTTP boundary; the service re-checks because it is also called
    // directly (WhatsApp menu flow).
    if (!!dto.resourceId === !!dto.resourceGroupId) {
      throw new BadRequestException('Exactly one of resourceId, resourceGroupId is required');
    }
    if (dto.resourceGroupId) {
      return this.createPooledHold(
        {
          resourceGroupId: dto.resourceGroupId,
          quantity: dto.quantity ?? 1,
          startTime: dto.startTime,
          durationMinutes: dto.durationMinutes,
        },
        actor,
      );
    }
    return this.createExclusiveHold(
      {
        resourceId: dto.resourceId!,
        startTime: dto.startTime,
        durationMinutes: dto.durationMinutes,
      },
      actor,
    );
  }

  private async createExclusiveHold(
    dto: { resourceId: string; startTime: string; durationMinutes: number },
    actor: AuthContext,
  ) {
    const env = loadEnv();
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime.getTime() <= Date.now()) {
      throw new BadRequestException('startTime must be a valid future timestamp');
    }
    const endTime = new Date(startTime.getTime() + dto.durationMinutes * 60 * 1000);

    const resource = await this.bookings.findResourceById(dto.resourceId);
    if (!resource || !resource.isBookable) {
      throw new NotFoundException('Resource not found');
    }
    const venue = await this.bookings.findVenueById(resource.venueId);
    if (!venue || venue.status !== 'ACTIVE') {
      throw new NotFoundException('Venue not found or not bookable');
    }
    // The venue's resolved BookingPolicy decides which starts/durations are
    // valid (grid, min/max/increment, lead time, advance window) — the same
    // rules search uses to generate slots. Invalid values are rejected, never
    // rounded.
    const policy = (await this.policyResolver.forVenue(venue)).resolve({ resourceId: resource.id });
    assertPolicyAllowsBooking(policy, {
      startTime,
      durationMinutes: dto.durationMinutes,
      timezone: venue.timezone,
    });
    if (
      !(await this.schedule.isWithinOpeningHours(
        venue.id,
        { resourceId: resource.id },
        startTime,
        endTime,
        venue.timezone,
      ))
    ) {
      throw new BadRequestException("This time is outside the venue's opening hours.");
    }

    const pricingRule = await this.resolvePricing(
      resource.id,
      dto.durationMinutes,
      startTime,
      venue.timezone,
    );
    const footprintIds = await this.resources.getFootprintResourceIds(resource.id);

    // Owner-configured blackout (ARCHITECTURE.md's Phase 10 notes) — the
    // availability search already excludes blocked windows, but a client
    // calling this endpoint directly (or racing a block created after
    // the search response) must be rejected here too; the ResourceLock
    // exclusion constraint below only guards against another *booking*,
    // not an owner's blackout, which lives in a separate table.
    if (await this.schedule.isBlocked(venue.id, { footprintIds }, startTime, endTime)) {
      throw new ConflictException('This time is blocked by the venue owner.');
    }

    // Buffers: the resource lock covers the booking PLUS its buffers, so the
    // existing exclusion constraint enforces the required gap atomically.
    const lockRange = paddedRange(policy, startTime, endTime);

    let booking;
    try {
      const holdExpiresAt = new Date(Date.now() + env.SLOT_HOLD_TTL_MINUTES * 60 * 1000);
      booking = await this.bookings.createHoldAtomic({
        resourceId: resource.id,
        customerId: actor.id,
        venueId: venue.id,
        startTime,
        endTime,
        lockStartTime: lockRange.start,
        lockEndTime: lockRange.end,
        holdExpiresAt,
        priceSnapshot: {
          amount: pricingRule.price.toString(),
          currency: pricingRule.currency,
          durationMinutes: dto.durationMinutes,
        },
        footprintIds,
        durationMinutes: dto.durationMinutes,
        groundType: resource.groundType,
        amount: pricingRule.price,
        currency: pricingRule.currency,
      });
    } catch (error) {
      if (isSlotConflictError(error)) {
        throw new ConflictException(
          'This slot is no longer available. Please choose another time.',
        );
      }
      throw error;
    }

    // Outside the transaction, awaited with errors swallowed — same
    // reliability pattern as this file's WhatsApp notify calls: a
    // notification failure must never undo an already-committed booking.
    await this.notifications
      .notifyOrganizationOwners(venue.organizationId, {
        type: 'BOOKING_CREATED',
        title: 'New booking',
        message: `A new booking has been created for ${venue.name}.`,
        data: { bookingId: booking.id, orderId: booking.orderId, venueId: venue.id, resourceId: resource.id },
      })
      .catch(() => undefined);

    return booking;
  }

  /**
   * P2 pooled-inventory hold (kayak fleets): reserves `quantity` units
   * out of a POOLED ResourceGroup's totalUnits for [start, end). Same
   * lifecycle/notify/refund surroundings as the exclusive path, but the
   * race is decided by row-lock + counted sum (see
   * createPooledHoldAtomic), never by the GiST exclusion constraint.
   * Start-time grid and duration caps stay on the legacy rules in P2;
   * P3's BookingPolicy relaxes them per venue/group.
   */
  private async createPooledHold(
    dto: { resourceGroupId: string; quantity: number; startTime: string; durationMinutes: number },
    actor: AuthContext,
  ) {
    const env = loadEnv();
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime.getTime() <= Date.now()) {
      throw new BadRequestException('startTime must be a valid future timestamp');
    }
    const endTime = new Date(startTime.getTime() + dto.durationMinutes * 60 * 1000);

    const group = await this.bookings.findResourceGroupById(dto.resourceGroupId);
    if (!group) {
      throw new NotFoundException('Resource group not found');
    }
    if (group.allocationMode !== 'POOLED') {
      throw new BadRequestException('Resource group is not pooled inventory');
    }
    if (group.totalUnits == null) {
      throw new BadRequestException('Resource group has no configured capacity');
    }
    if (dto.quantity > group.totalUnits) {
      throw new BadRequestException('Requested quantity exceeds group capacity');
    }
    const venue = await this.bookings.findVenueById(group.venueId);
    if (!venue || venue.status !== 'ACTIVE') {
      throw new NotFoundException('Venue not found or not bookable');
    }
    // Group-scoped policy (GROUP > VENUE > CATEGORY > default): grid, duration
    // steps, lead time and advance window. Buffers do not apply to counted
    // pooled inventory (there is no per-unit lock to pad).
    const policy = (await this.policyResolver.forVenue(venue)).resolve({ resourceGroupId: group.id });
    assertPolicyAllowsBooking(policy, {
      startTime,
      durationMinutes: dto.durationMinutes,
      timezone: venue.timezone,
    });
    if (
      !(await this.schedule.isWithinOpeningHours(
        venue.id,
        { resourceGroupId: group.id },
        startTime,
        endTime,
        venue.timezone,
      ))
    ) {
      throw new BadRequestException("This time is outside the venue's opening hours.");
    }

    const { rule, amount } = await this.resolveGroupPricing(
      group.id,
      dto.durationMinutes,
      dto.quantity,
      startTime,
      venue.timezone,
    );

    // Venue-wide blackout fast-fail (authoritative state for pooled
    // capacity itself lives in the atomic writer, same split as the
    // exclusive path's blackout pre-check vs exclusion constraint).
    if (await this.schedule.isBlocked(venue.id, { resourceGroupId: group.id }, startTime, endTime)) {
      throw new ConflictException('This time is blocked by the venue owner.');
    }
    const held = await this.bookings.sumHeldGroupQuantity(group.id, startTime, endTime);
    if (held + dto.quantity > group.totalUnits) {
      throw new ConflictException(
        'Not enough units available for this time. Please reduce the quantity or choose another time.',
      );
    }

    let booking;
    try {
      const holdExpiresAt = new Date(Date.now() + env.SLOT_HOLD_TTL_MINUTES * 60 * 1000);
      booking = await this.bookings.createPooledHoldAtomic({
        resourceGroupId: group.id,
        quantity: dto.quantity,
        customerId: actor.id,
        venueId: venue.id,
        startTime,
        endTime,
        holdExpiresAt,
        priceSnapshot: {
          amount: amount.toString(),
          currency: rule.currency,
          durationMinutes: dto.durationMinutes,
          quantity: dto.quantity,
          unitPrice: rule.price.toString(),
        },
        durationMinutes: dto.durationMinutes,
        unitLabel: group.name,
        amount,
        currency: rule.currency,
      });
    } catch (error) {
      // ConflictException from the atomic writer (race lost) passes
      // through untouched; exclusion-constraint SQLSTATEs are mapped
      // defensively although the pooled path never takes that branch.
      if (error instanceof ConflictException || isSlotConflictError(error)) {
        throw error instanceof ConflictException
          ? error
          : new ConflictException(
              'This slot is no longer available. Please choose another time.',
            );
      }
      throw error;
    }

    await this.notifications
      .notifyOrganizationOwners(venue.organizationId, {
        type: 'BOOKING_CREATED',
        title: 'New booking',
        message: `A new booking has been created for ${venue.name}.`,
        data: {
          bookingId: booking.id,
          orderId: booking.orderId,
          venueId: venue.id,
          resourceGroupId: group.id,
          quantity: dto.quantity,
        },
      })
      .catch(() => undefined);

    return booking;
  }

  /**
   * Read-only pooled preview mirroring previewSlot: remaining capacity
   * + price for an explicit start time, no rows written. Two customers
   * previewing the same units both see them as available; the atomic
   * writer decides who wins.
   */
  async previewGroupSlot(
    resourceGroupId: string,
    startTime: Date,
    durationMinutes: number,
    quantity = 1,
  ): Promise<
    | { available: false }
    | {
        available: true;
        venue: { id: string; name: string; facilityCode: string; timezone: string };
        group: { id: string; name: string; allocationMode: string; totalUnits: number | null };
        remaining: number;
        price: { amount: string; currency: string; unitPrice: string; quantity: number } | null;
      }
  > {
    if (!Number.isInteger(quantity) || quantity < 1) return { available: false };
    const group = await this.bookings.findResourceGroupById(resourceGroupId);
    if (!group || group.allocationMode !== 'POOLED' || group.totalUnits == null) {
      return { available: false };
    }
    const venue = await this.bookings.findVenueById(group.venueId);
    if (!venue || venue.status !== 'ACTIVE') return { available: false };

    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    if (await this.schedule.isBlocked(venue.id, { resourceGroupId: group.id }, startTime, endTime)) {
      return { available: false };
    }

    const held = await this.bookings.sumHeldGroupQuantity(group.id, startTime, endTime);
    const remaining = Math.max(0, group.totalUnits - held);
    if (remaining < quantity) return { available: false };

    const rule = await this.findGroupPricingRule(group.id, durationMinutes, startTime, venue.timezone);
    return {
      available: true,
      venue: { id: venue.id, name: venue.name, facilityCode: venue.facilityCode, timezone: venue.timezone },
      group: {
        id: group.id,
        name: group.name,
        allocationMode: group.allocationMode,
        totalUnits: group.totalUnits,
      },
      remaining,
      price: rule
        ? {
            amount: this.priceGroupAmount(rule, quantity).toString(),
            currency: rule.currency,
            unitPrice: rule.price.toString(),
            quantity,
          }
        : null,
    };
  }

  /**
   * Read-only availability + price check for a specific resource/time,
   * with none of createHold's side effects (no SlotHold/ResourceLock rows
   * created). Used by the WhatsApp "Book This Slot" deep-link flow
   * (WhatsAppMenuService.handleBookIntent) to show the customer a price
   * and ask them to confirm BEFORE actually reserving the slot — createHold
   * itself is still what performs the real, atomic reservation once they
   * say yes, so this is deliberately a plain read: two customers previewing
   * the same slot at once both see it as available, and whichever one
   * actually confirms first is the one createHold's exclusion constraint
   * lets through.
   */
  async previewSlot(
    resourceId: string,
    startTime: Date,
    durationMinutes: number,
  ): Promise<
    | { available: false }
    | {
        available: true;
        venue: { id: string; name: string; facilityCode: string; timezone: string };
        resource: { id: string; name: string; groundType: string };
        price: { amount: string; currency: string } | null;
      }
  > {
    const resource = await this.bookings.findResourceById(resourceId);
    if (!resource || !resource.isBookable) return { available: false };
    const venue = await this.bookings.findVenueById(resource.venueId);
    if (!venue || venue.status !== 'ACTIVE') return { available: false };

    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);
    const footprintIds = await this.resources.getFootprintResourceIds(resourceId);

    // Locks are stored buffer-padded, so the preview pads the candidate too.
    const policy = (await this.policyResolver.forVenue(venue)).resolve({ resourceId: resource.id });
    const padded = paddedRange(policy, startTime, endTime);
    const lock = await this.bookings.findOverlappingLock(footprintIds, padded.start, padded.end);
    if (lock) return { available: false };

    if (await this.schedule.isBlocked(venue.id, { footprintIds }, startTime, endTime)) {
      return { available: false };
    }

    const rule = await this.findPricingRule(resource.id, durationMinutes, startTime, venue.timezone);
    return {
      available: true,
      venue: { id: venue.id, name: venue.name, facilityCode: venue.facilityCode, timezone: venue.timezone },
      resource: { id: resource.id, name: resource.name, groundType: resource.groundType },
      price: rule ? { amount: rule.price.toString(), currency: rule.currency } : null,
    };
  }

  /**
   * Owner-recorded walk-in/offline booking (ARCHITECTURE.md's Phase 10
   * extension): the same conflict-prevention machinery as createHold
   * (ResourceLock exclusion constraint, blocked-date check) but created
   * directly at CONFIRMED — there's no separate hold-then-pay step since
   * no gateway is involved, and the "must be in the future" restriction
   * is dropped since an owner may be logging a walk-in that already
   * started.
   */
  async createOfflineBooking(dto: CreateOfflineBookingDto, actor: AuthContext) {
    const startTime = new Date(dto.startTime);
    if (Number.isNaN(startTime.getTime())) {
      throw new BadRequestException('startTime must be a valid timestamp');
    }
    const endTime = new Date(startTime.getTime() + dto.durationMinutes * 60 * 1000);

    const resource = await this.bookings.findResourceById(dto.resourceId);
    if (!resource || !resource.isBookable) {
      throw new NotFoundException('Resource not found');
    }
    const venue = await this.bookings.findVenueById(resource.venueId);
    if (!venue || venue.status !== 'ACTIVE') {
      throw new NotFoundException('Venue not found or not bookable');
    }
    if (venue.organizationId !== actor.organizationId) {
      throw new ForbiddenException("Cannot book another organization's venue");
    }
    // Owner walk-ins keep the grid + duration rules but may be logged after
    // the fact or far ahead (no lead-time / advance-window limits) and are not
    // restricted to opening hours — the owner is on site.
    const policy = (await this.policyResolver.forVenue(venue)).resolve({ resourceId: resource.id });
    assertPolicyAllowsBooking(policy, {
      startTime,
      durationMinutes: dto.durationMinutes,
      timezone: venue.timezone,
      skipLeadAndAdvance: true,
    });

    let amount = dto.amount;
    let currency = 'INR';
    if (amount === undefined) {
      const rule = await this.findPricingRule(resource.id, dto.durationMinutes, startTime, venue.timezone);
      if (!rule) {
        throw new BadRequestException(
          'No pricing configured for this resource/duration — enter an amount manually',
        );
      }
      amount = Number(rule.price);
      currency = rule.currency;
    }

    const footprintIds = await this.resources.getFootprintResourceIds(resource.id);

    if (await this.schedule.isBlocked(venue.id, { footprintIds }, startTime, endTime)) {
      throw new ConflictException('This time is blocked on this venue.');
    }
    const lockRange = paddedRange(policy, startTime, endTime);

    const customer = await this.customers.findOrCreateByWhatsAppNumber(dto.customerWhatsappNumber);
    if (dto.customerName && !customer.name) {
      await this.customers.updateName(customer.id, dto.customerName);
    }

    try {
      const booking = await this.bookings.createOfflineAtomic({
        resourceId: resource.id,
        customerId: customer.id,
        venueId: venue.id,
        startTime,
        endTime,
        lockStartTime: lockRange.start,
        lockEndTime: lockRange.end,
        holdExpiresAt: endTime,
        priceSnapshot: { amount: String(amount), currency, durationMinutes: dto.durationMinutes },
        footprintIds,
        durationMinutes: dto.durationMinutes,
        groundType: resource.groundType,
        amount,
        currency,
        paymentMethod: 'OFFLINE',
      });

      await this.audit.record({
        actor,
        action: 'OFFLINE_BOOKING_CREATED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: { orderId: booking.orderId, resourceId: resource.id, customerId: customer.id },
      });

      // Excludes the acting owner — they already know, having just
      // created it themselves; their teammates (e.g. OWNER_ADMIN when a
      // OWNER_STAFF logged the walk-in) still need to hear about it.
      await this.notifications
        .notifyOrganizationOwners(
          venue.organizationId,
          {
            type: 'BOOKING_CONFIRMED',
            title: 'Booking confirmed',
            message: `Booking ${booking.orderId} has been confirmed.`,
            data: {
              bookingId: booking.id,
              orderId: booking.orderId,
              venueId: venue.id,
              resourceId: resource.id,
            },
          },
          { excludeOwnerId: actor.role === 'VENUE_OWNER' ? actor.id : undefined },
        )
        .catch(() => undefined);

      return booking;
    } catch (error) {
      if (isSlotConflictError(error)) {
        throw new ConflictException(
          'This slot is no longer available. Please choose another time.',
        );
      }
      throw error;
    }
  }

  private async findPricingRule(
    resourceId: string,
    durationMinutes: number,
    at: Date,
    venueTimezone: string,
  ) {
    // Weekday/weekend must be evaluated in the VENUE's local time, not the
    // server's (ARCHITECTURE.md engineering rule #11) — a booking a few
    // hours either side of local midnight can otherwise land on the
    // wrong calendar day and price against the wrong DayType.
    const localWeekday = DateTime.fromJSDate(at, { zone: venueTimezone }).weekday; // luxon: 1=Mon..7=Sun
    const dayType = localWeekday === 6 || localWeekday === 7 ? 'WEEKEND' : 'WEEKDAY';
    return this.bookings.findPricingRule(resourceId, durationMinutes, dayType, at);
  }

  private async resolvePricing(
    resourceId: string,
    durationMinutes: number,
    at: Date,
    venueTimezone: string,
  ) {
    const rule = await this.findPricingRule(resourceId, durationMinutes, at, venueTimezone);
    if (!rule) {
      throw new BadRequestException('No pricing configured for this resource/duration');
    }
    return rule;
  }

  private async findGroupPricingRule(
    resourceGroupId: string,
    durationMinutes: number,
    at: Date,
    venueTimezone: string,
  ) {
    // Same venue-local DayType rule as the exclusive path (§11) — a
    // booking near local midnight must price against the right day.
    const localWeekday = DateTime.fromJSDate(at, { zone: venueTimezone }).weekday; // luxon: 1=Mon..7=Sun
    const dayType = localWeekday === 6 || localWeekday === 7 ? 'WEEKEND' : 'WEEKDAY';
    return this.bookings.findGroupPricingRule(resourceGroupId, durationMinutes, dayType, at);
  }

  private priceGroupAmount(
    rule: { price: Prisma.Decimal; pricingMode: string },
    quantity: number,
  ) {
    return rule.pricingMode === 'PER_UNIT' ? rule.price.mul(quantity) : rule.price;
  }

  private async resolveGroupPricing(
    resourceGroupId: string,
    durationMinutes: number,
    quantity: number,
    at: Date,
    venueTimezone: string,
  ) {
    const rule = await this.findGroupPricingRule(resourceGroupId, durationMinutes, at, venueTimezone);
    if (!rule) {
      throw new BadRequestException('No pricing configured for this group/duration');
    }
    return { rule, amount: this.priceGroupAmount(rule, quantity) };
  }

  async getForCustomer(bookingId: string, actor: AuthContext) {
    const booking = await this.bookings.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) {
      throw new ForbiddenException("Cannot access another customer's booking");
    }
    return booking;
  }

  async listForCustomer(actor: AuthContext) {
    return this.bookings.listForCustomer(actor.id);
  }

  /**
   * Platform-wide listing for the Super Admin Portal (§12: Super Admin
   * has visibility across every organization, unlike a Venue Owner who is
   * always org-scoped). Filters are all optional and additive.
   */
  async listForAdmin(filters: {
    status?: string;
    venueId?: string;
    organizationId?: string;
    limit?: number;
  }) {
    return this.bookings.listForAdmin(filters);
  }

  /** Org-scoped listing for the Venue Owner Portal (§12: an owner sees
   * only their own organization's venues, never platform-wide). */
  async listForOwner(organizationId: string, filters: { status?: string; venueId?: string; limit?: number }) {
    return this.bookings.listForOwner(organizationId, filters);
  }

  async getForOwner(bookingId: string, organizationId: string) {
    const booking = await this.getForAdmin(bookingId);
    if (booking.venue.organizationId !== organizationId) {
      throw new ForbiddenException("Cannot access another organization's booking");
    }
    return booking;
  }

  async getForAdmin(bookingId: string) {
    const booking = await this.bookings.findBookingDetailById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /**
   * A never-paid (PENDING_PAYMENT) booking is a legal cancellation
   * target too (BOOKING_TRANSITIONS allows it — e.g. the customer backs
   * out before paying) but must NOT produce a refund: nothing was paid,
   * so there is nothing to return as coins. Only a CONFIRMED booking
   * goes through the cancellation-policy/refund path. Where a Refund IS
   * created, it's left in PENDING status here — actually crediting Venue
   * Coins is Phase 7's CoinsService, which will pick up PENDING refunds
   * and move them through PROCESSING -> COMPLETED (§7/§11). Intentionally
   * incomplete pending that phase, not a bug.
   */
  async cancel(bookingId: string, reason: string | undefined, actor: AuthContext) {
    const booking = await this.getForCustomer(bookingId, actor);
    assertTransition('Booking', BOOKING_TRANSITIONS, booking.status, 'CANCELLED');
    const wasPaid = booking.status === 'CONFIRMED';

    let refundPlan: {
      policyId: string;
      refundPercent: number;
      hoursBeforeStart: number;
      coinAmountCredited: Prisma.Decimal;
    } | null = null;
    if (wasPaid) {
      const policy = await this.policies.resolveCancellationPolicy(booking.venueId);
      const hoursBeforeStart = (booking.startTime.getTime() - Date.now()) / (1000 * 60 * 60);
      const tiers = policy.tiers as Array<{ minHoursBeforeStart: number; refundPercent: number }>;
      const applicableTier = [...tiers]
        .sort((a, b) => b.minHoursBeforeStart - a.minHoursBeforeStart)
        .find((tier) => hoursBeforeStart >= tier.minHoursBeforeStart);
      const refundPercent = applicableTier?.refundPercent ?? 0;
      refundPlan = {
        policyId: policy.id,
        refundPercent,
        hoursBeforeStart,
        coinAmountCredited: booking.amount.mul(refundPercent).div(100),
      };
    }

    const result = await this.bookings.cancelAtomic({
      bookingId,
      expectedBookingStatus: booking.status,
      slotHoldId: booking.slotHoldId,
      reason,
      refundData: refundPlan
        ? {
            originalAmount: booking.amount,
            originalCurrency: booking.currency,
            coinAmountCredited: refundPlan.coinAmountCredited,
            policySnapshot: refundPlan,
          }
        : null,
    });

    // Completing the refund (actually crediting coins) is a separate
    // call, deliberately outside the transaction above — CoinsService
    // does its own wallet-row locking and shouldn't be composed into an
    // already-open transaction that's also touching Booking/SlotHold/
    // ResourceLock (Refund.PENDING already committed is a safe
    // intermediate state if this second step fails; nothing here can
    // double-credit thanks to the idempotency key).
    if (result.refund) {
      // Overwrite the stale PENDING snapshot from inside the transaction
      // above with the post-completion row, so the response the caller
      // sees matches what's actually in the database by the time they
      // see it (caught live: the DB and the ledger were always correct,
      // but the HTTP response briefly claimed PENDING for an already-
      // COMPLETED refund).
      result.refund = await this.coins.completeRefund(result.refund.id);
    }

    await this.audit.record({
      actor,
      action: 'BOOKING_CANCELLED',
      entityType: 'Booking',
      entityId: bookingId,
      metadata: result.refund
        ? {
            refundId: result.refund.id,
            refundPercent: refundPlan?.refundPercent,
            coinAmountCredited: refundPlan?.coinAmountCredited.toString(),
          }
        : { refund: 'none (booking was never paid)' },
    });

    // Sent from here, not per-channel — a cancellation initiated from
    // the web app notifies over WhatsApp exactly the same as one
    // initiated from WhatsApp itself (§15). Awaited (errors swallowed,
    // never thrown) rather than fire-and-forget: when this cancellation
    // was itself triggered from the WhatsApp menu, the menu handler
    // sends its own "back to main menu" message right after this method
    // returns — firing the notification without awaiting it let that
    // next message race ahead and arrive first, confirmed live (the
    // "cancelled" confirmation showed up *after* the main menu in
    // testing). Awaiting fixes the ordering; the .catch keeps a
    // notification failure from failing the cancellation itself.
    await this.notifyCancellation(booking.customerId, result).catch(() => undefined);

    // Cancellation here is always customer-initiated (there's no
    // owner/admin cancel endpoint in this codebase today) — the venue's
    // organization always needs to hear about it.
    const venue = await this.bookings.findVenueById(booking.venueId);
    if (venue) {
      await this.notifications
        .notifyOrganizationOwners(venue.organizationId, {
          type: 'BOOKING_CANCELLED',
          title: 'Booking cancelled',
          message: `Booking ${booking.orderId} has been cancelled.`,
          // P2: exactly one of resourceId/resourceGroupId is set.
          data: {
            bookingId: booking.id,
            orderId: booking.orderId,
            venueId: booking.venueId,
            ...(booking.resourceId ? { resourceId: booking.resourceId } : {}),
            ...(booking.resourceGroupId ? { resourceGroupId: booking.resourceGroupId } : {}),
          },
        })
        .catch(() => undefined);
    }

    return result;
  }

  private async notifyCancellation(
    customerId: string,
    result: { booking: { orderId: string }; refund: { coinAmountCredited: Prisma.Decimal } | null },
  ): Promise<void> {
    const customer = await this.bookings.findCustomerById(customerId);
    if (!customer) return;
    const refundLine = result.refund
      ? `\n🪙 ${result.refund.coinAmountCredited} Coins credited.`
      : '';
    await this.whatsapp.sendText(
      customer.whatsappNumber,
      `✅ Booking ${result.booking.orderId} cancelled.${refundLine}`,
    );
  }
}
