import { INDIAN_MOBILE_MESSAGE, normalizeIndianMobile } from '../common/phone';
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
  cancellationDeadlines,
  cancellationOutcome,
  commercialTermsSchema,
  fromMinor,
  toMinor,
  type CommercialTerms,
} from '@venue/shared';
import { loadEnv } from '@venue/config';
import { Prisma, type BookingStatus } from '@venue/database';
import { pickPricingRule, effectivePrice, atLeastMinAdvance, priceBooking } from '../pricing/pricing-rules';
import { ResourcesService } from '../resources/resources.service';
import { BOOKINGS_REPOSITORY, type AdminBookingFilters, type BookingsRepository } from './bookings.repository';
import { AuditService } from '../audit/audit.service';
import { CoinsService } from '../coins/coins.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateOfflineBookingDto } from './dto/booking.dto';
import { PolicyResolverService } from '../scheduling/policy-resolver.service';
import { ScheduleService } from '../scheduling/schedule.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import { CommercialTermsService } from '../commercial/commercial-terms.service';
import { SettlementsService } from '../settlements/settlements.service';
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
    private readonly audit: AuditService,
    private readonly coins: CoinsService,
    @Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,
    private readonly notifications: NotificationsService,
    private readonly policyResolver: PolicyResolverService,
    private readonly schedule: ScheduleService,
    private readonly scope: OwnerScopeService,
    private readonly commercialTerms: CommercialTermsService,
    private readonly settlements: SettlementsService,
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
    await this.assertContactVerified(actor.id);
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

  /**
   * Booking needs a way to reach the customer that has been proved: a verified email or a verified phone number.
   * Someone who has verified neither (an email typed into a profile, a number nobody confirmed) can look, but not book.
   */
  private async assertContactVerified(customerId: string) {
    const customer = await this.bookings.findCustomerById(customerId);
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.emailVerified && !customer.phoneVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CONTACT_NOT_VERIFIED',
        message: 'Verify your email or phone number before booking a slot.',
      });
    }
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
      advanceDays: venue.advanceBookingDays,
    });
    if (
      !(await this.schedule.isWithinOpeningHours(
        { resourceId: resource.id },
        startTime,
        endTime,
        venue.timezone,
      ))
    ) {
      throw new BadRequestException("This can't be booked at that time: no price covers it.");
    }

    const price = await this.priceForBooking(resource, startTime, dto.durationMinutes, venue.timezone);
    // The facility's commercial terms at booking time, kept on the booking (cancellation windows, commission).
    const { terms } = await this.commercialTerms.resolve(venue.id, resource.categoryId);
    const amount = new Prisma.Decimal(price.amount);
    const advanceAmount = atLeastMinAdvance(new Prisma.Decimal(price.advance), amount, terms);
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
        // What this booking was priced at, so a later price change never alters it: the total and, per block of the
        // unit's minimum length, the price of each block.
        priceSnapshot: {
          amount: String(price.amount),
          currency: price.currency,
          durationMinutes: dto.durationMinutes,
          blockMinutes: resource.minDurationMinutes,
          normalPrice: String(price.normalAmount),
          bookingPrice: String(price.advance),
          blocks: price.blocks.map((b) => ({
            start: b.start.toISOString(),
            amount: String(b.amount),
            normalAmount: b.normalAmount === null ? null : String(b.normalAmount),
            bookingPrice: String(b.bookingPrice),
          })),
        },
        footprintIds,
        durationMinutes: dto.durationMinutes,
        // A unit with no sub-type is recorded under its name so the booking still says what was booked.
        groundType: resource.groundType || resource.name,
        // The full price (offer if there is one); only the booking price (the advance) is charged online,
        // never less than the facility's minimum advance.
        amount,
        advanceAmount,
        currency: price.currency,
        commercialTerms: terms,
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
      advanceDays: venue.advanceBookingDays,
    });
    if (
      !(await this.schedule.isWithinOpeningHours(
        { resourceGroupId: group.id },
        startTime,
        endTime,
        venue.timezone,
      ))
    ) {
      throw new BadRequestException("This can't be booked at that time: no price covers it.");
    }

    const { rule, amount, advance: ruleAdvance } = await this.resolveGroupPricing(
      group.id,
      dto.durationMinutes,
      dto.quantity,
      startTime,
      venue.timezone,
    );
    const { terms } = await this.commercialTerms.resolve(venue.id, group.categoryId);
    const advance = atLeastMinAdvance(ruleAdvance, amount, terms);

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
          unitPrice: String(effectivePrice(rule)),
          bookingPrice: rule.bookingPrice.toString(),
        },
        durationMinutes: dto.durationMinutes,
        unitLabel: group.name,
        amount,
        advanceAmount: advance,
        currency: rule.currency,
        commercialTerms: terms,
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
   * Read-only pooled preview: remaining capacity
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
        price: { amount: string; advanceAmount: string; currency: string; unitPrice: string; quantity: number } | null;
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
    const { terms } = await this.commercialTerms.resolve(venue.id, group.categoryId);
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
            advanceAmount: atLeastMinAdvance(
              this.advanceGroupAmount(rule, quantity),
              this.priceGroupAmount(rule, quantity),
              terms,
            ).toString(),
            currency: rule.currency,
            unitPrice: String(effectivePrice(rule)),
            quantity,
          }
        : null,
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
    await this.scope.assertVenue(actor, venue.id);
    // Owner walk-ins keep the grid + duration rules but may be logged after
    // the fact or far ahead (no lead-time / advance-window limits) and are not
    // restricted to the times a price covers — the owner is on site.
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
      const price = await this.findBookingPrice(resource, startTime, dto.durationMinutes, venue.timezone);
      if (!price) {
        throw new BadRequestException(
          'No pricing configured for this resource/duration — enter an amount manually',
        );
      }
      amount = price.amount;
      currency = price.currency;
    }
    // A walk-in is paid at the venue. By default it was paid in full; staff can record less (an advance),
    // and the rest shows as remaining on the booking.
    const amountPaid = dto.amountPaid ?? amount;
    if (amountPaid > amount) {
      throw new BadRequestException("The amount collected can't be more than the booking amount.");
    }

    const footprintIds = await this.resources.getFootprintResourceIds(resource.id);

    if (await this.schedule.isBlocked(venue.id, { footprintIds }, startTime, endTime)) {
      throw new ConflictException('This time is blocked on this venue.');
    }
    const lockRange = paddedRange(policy, startTime, endTime);

    // A walk-in is for someone without an account: their name and phone are kept on the booking itself and are
    // never matched with, or added to, the customer accounts (so it never shows under anyone's My bookings).
    const walkInPhone = normalizeIndianMobile(dto.customerWhatsappNumber);
    if (!walkInPhone) throw new BadRequestException(INDIAN_MOBILE_MESSAGE);

    try {
      const booking = await this.bookings.createOfflineAtomic({
        resourceId: resource.id,
        walkIn: { name: dto.customerName?.trim() || null, phone: walkInPhone },
        venueId: venue.id,
        startTime,
        endTime,
        lockStartTime: lockRange.start,
        lockEndTime: lockRange.end,
        holdExpiresAt: endTime,
        priceSnapshot: { amount: String(amount), currency, durationMinutes: dto.durationMinutes },
        footprintIds,
        durationMinutes: dto.durationMinutes,
        groundType: resource.groundType || resource.name,
        amount,
        advanceAmount: 0,
        paidAmount: amountPaid,
        currency,
        paymentMethod: 'OFFLINE',
      });

      await this.audit.record({
        actor,
        action: 'OFFLINE_BOOKING_CREATED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: { orderId: booking.orderId, resourceId: resource.id, walkIn: true },
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

  /**
   * The price of a booking of this unit: its block price for every block of its minimum length the booking spans, each
   * looked up at the block's own start. The day and time of day are evaluated in the VENUE's local time, not the
   * server's (ARCHITECTURE.md engineering rule #11) — a booking a few hours either side of local midnight can otherwise
   * land on the wrong calendar day and price against the wrong rule. Null when some block has no price.
   */
  private async findBookingPrice(
    resource: { id: string; minDurationMinutes: number },
    start: Date,
    durationMinutes: number,
    venueTimezone: string,
  ) {
    const lastBlockStart = new Date(start.getTime() + (durationMinutes - resource.minDurationMinutes) * 60_000);
    const rules = await this.bookings.findPricingRules(resource.id, lastBlockStart);
    return priceBooking(rules, start, durationMinutes, resource.minDurationMinutes, venueTimezone);
  }

  private async priceForBooking(
    resource: { id: string; minDurationMinutes: number },
    start: Date,
    durationMinutes: number,
    venueTimezone: string,
  ) {
    const price = await this.findBookingPrice(resource, start, durationMinutes, venueTimezone);
    if (!price) {
      throw new BadRequestException('No pricing configured for this resource/duration');
    }
    return price;
  }

  private async findGroupPricingRule(
    resourceGroupId: string,
    durationMinutes: number,
    at: Date,
    venueTimezone: string,
  ) {
    // Same venue-local day/time rule as the exclusive path (§11).
    const rules = await this.bookings.findGroupPricingRules(resourceGroupId, durationMinutes, at);
    return pickPricingRule(rules, at, venueTimezone);
  }

  /** The full price of a pooled booking: the offer (else normal) price, times the quantity for PER_UNIT. */
  private priceGroupAmount(
    rule: { normalPrice: Prisma.Decimal; offerPrice: Prisma.Decimal | null; pricingMode: string },
    quantity: number,
  ) {
    const full = new Prisma.Decimal(effectivePrice(rule));
    return rule.pricingMode === 'PER_UNIT' ? full.mul(quantity) : full;
  }

  /** The advance charged online for a pooled booking (the booking price, times the quantity for PER_UNIT). */
  private advanceGroupAmount(rule: { bookingPrice: Prisma.Decimal; pricingMode: string }, quantity: number) {
    return rule.pricingMode === 'PER_UNIT' ? rule.bookingPrice.mul(quantity) : rule.bookingPrice;
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
    return {
      rule,
      amount: this.priceGroupAmount(rule, quantity),
      advance: this.advanceGroupAmount(rule, quantity),
    };
  }

  async getForCustomer(bookingId: string, actor: AuthContext) {
    const booking = await this.bookings.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) {
      throw new ForbiddenException("Cannot access another customer's booking");
    }
    return booking;
  }

  /**
   * What the website checkout/receipt page renders: the booking row plus the
   * venue, the unit's name and until when the slot is held. Same ownership
   * rule as getForCustomer; the extra fields are additive.
   */
  async getCheckoutViewForCustomer(bookingId: string, actor: AuthContext) {
    const view = await this.bookings.findBookingCheckoutViewById(bookingId);
    if (!view) throw new NotFoundException('Booking not found');
    if (view.customerId !== actor.id) {
      throw new ForbiddenException("Cannot access another customer's booking");
    }
    const { resource, slotHold, ...booking } = view;
    return {
      ...booking,
      resourceName: resource?.name ?? null,
      holdExpiresAt: slotHold.holdExpiresAt,
    };
  }

  async listForCustomer(actor: AuthContext) {
    return this.bookings.listForCustomer(actor.id);
  }

  /**
   * Platform-wide listing for the Super Admin Portal (§12: Super Admin
   * has visibility across every organization, unlike a Venue Owner who is
   * always org-scoped). Filters are all optional and additive.
   */
  async listForAdmin(filters: AdminBookingFilters & { limit?: number; offset?: number }) {
    return this.bookings.listForAdmin(filters);
  }

  async countForAdmin(filters: AdminBookingFilters) {
    return this.bookings.countForAdmin(filters);
  }

  /** Org-scoped listing for the Venue Owner Portal (§12: an owner sees
   * only their own organization's venues, never platform-wide). */
  async getForOwner(bookingId: string, organizationId: string) {
    const booking = await this.getForAdmin(bookingId);
    if (booking.venue.organizationId !== organizationId) {
      throw new ForbiddenException("Cannot access another organization's booking");
    }
    return booking;
  }

  /**
   * Records the balance of a booking being paid at the venue (the part of the full price not charged online).
   * Owner admins and the staff assigned to the venue only; only a confirmed or completed booking can be paid up.
   */
  async collectBalance(bookingId: string, amount: number | undefined, actor: AuthContext) {
    const booking = await this.getForOwner(bookingId, actor.organizationId!);
    await this.scope.assertVenue(actor, booking.venue.id);
    if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
      throw new BadRequestException(`A ${booking.status.toLowerCase().replace('_', ' ')} booking can't be paid.`);
    }
    const remaining = booking.amount.sub(booking.paidAmount);
    if (remaining.lte(0)) throw new BadRequestException('Nothing is left to collect on this booking.');
    const collect = amount === undefined ? remaining : new Prisma.Decimal(amount);
    if (collect.gt(remaining)) {
      throw new BadRequestException(`Only ${booking.currency} ${remaining.toString()} is left to collect.`);
    }
    const updated = await this.bookings.addPaidAmount(bookingId, collect);
    await this.audit.record({
      actor,
      action: 'BOOKING_BALANCE_COLLECTED',
      entityType: 'Booking',
      entityId: bookingId,
      metadata: { orderId: booking.orderId, collected: collect.toString(), paidAmount: updated.paidAmount.toString() },
    });
    return updated;
  }

  async getForAdmin(bookingId: string) {
    const booking = await this.bookings.findBookingDetailById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /**
   * The commercial terms a booking runs on: the snapshot taken when it was made, or (bookings made before
   * commercial terms existed) the facility's current terms.
   */
  private async termsForBooking(booking: {
    venueId: string;
    resourceId: string | null;
    resourceGroupId: string | null;
    commercialTerms: Prisma.JsonValue;
  }): Promise<CommercialTerms> {
    const snapshot = commercialTermsSchema.safeParse(booking.commercialTerms);
    if (snapshot.success) return snapshot.data;
    const categoryId = await this.commercialTerms.categoryOf(booking);
    return (await this.commercialTerms.resolve(booking.venueId, categoryId)).terms;
  }

  /** What was paid online for a booking (0 when nothing was: unpaid, or a walk-in). */
  private paidOnlineMinor(booking: { status: string; advanceAmount: Prisma.Decimal }): number {
    return booking.status === 'CONFIRMED' && booking.advanceAmount.gt(0) ? toMinor(booking.advanceAmount.toString()) : 0;
  }

  /**
   * What cancelling would do right now, for the customer's booking page and checkout: the windows as absolute
   * times, when cancelling closes, and what cancelling now returns as coins.
   */
  async cancellationPreview(bookingId: string, actor: AuthContext) {
    const booking = await this.getForCustomer(bookingId, actor);
    const cancellable = BOOKING_TRANSITIONS[booking.status]?.includes('CANCELLED') ?? false;
    const terms = await this.termsForBooking(booking);
    const { windows, closesAt } = cancellationDeadlines(terms, booking.startTime);
    const paidMinor = this.paidOnlineMinor(booking);
    const outcome = paidMinor > 0 ? cancellationOutcome(terms, minutesUntil(booking.startTime), paidMinor) : null;
    return {
      canCancel: cancellable && (outcome === null || outcome.allowed),
      currency: booking.currency,
      paidOnline: fromMinor(paidMinor),
      // null when nothing was paid (an unpaid hold is simply dropped) or cancelling is closed.
      now:
        outcome && outcome.allowed
          ? { refundPercent: outcome.tier.refundPercent, refundCoins: fromMinor(outcome.refundMinor) }
          : null,
      windows: windows.map((w) => ({ until: w.until.toISOString(), refundPercent: w.refundPercent })),
      closesAt: closesAt.toISOString(),
    };
  }

  /**
   * A customer cancels their own booking, under the terms it was made with (ARCHITECTURE.md §11): inside a
   * window the paid amount is split into coins back / owner share / platform share (a share for the owner or
   * the platform is recorded as a LATE_CANCEL settlement); inside the cut-off a paid booking can't be
   * cancelled. An unpaid (PENDING_PAYMENT) hold can always be dropped and refunds nothing.
   */
  async cancel(bookingId: string, reason: string | undefined, actor: AuthContext) {
    const booking = await this.getForCustomer(bookingId, actor);
    assertCancellable(booking.status);

    const paidMinor = this.paidOnlineMinor(booking);
    if (paidMinor === 0) {
      return this.performCancellation(booking, { reasonCode: 'CUSTOMER_REQUESTED', reason, actor, refund: null, settlement: null });
    }

    const terms = await this.termsForBooking(booking);
    const minutesBeforeStart = minutesUntil(booking.startTime);
    const outcome = cancellationOutcome(terms, minutesBeforeStart, paidMinor);
    if (!outcome.allowed) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'CANCELLATION_CLOSED',
        message: `This booking can no longer be cancelled: cancelling closes ${describeMinutes(terms.cancelCutoffMinutes)} before the start.`,
      });
    }
    const context = await this.settlements.contextOf(booking);
    return this.performCancellation(booking, {
      reasonCode: 'CUSTOMER_REQUESTED',
      reason,
      actor,
      refund: {
        coinMinor: outcome.refundMinor,
        paidMinor,
        snapshot: {
          refundPercent: outcome.tier.refundPercent,
          ownerPercent: outcome.tier.ownerPercent,
          minutesBeforeStart: Math.round(minutesBeforeStart),
          coinAmountCredited: fromMinor(outcome.refundMinor),
          ownerAmount: fromMinor(outcome.ownerMinor),
          platformAmount: fromMinor(outcome.platformMinor),
        },
      },
      settlement: this.settlements.lateCancelData(booking, context, paidMinor, outcome, minutesBeforeStart),
    });
  }

  /**
   * The venue (owner admin or its assigned staff) or the Super Admin cancels a booking — rain, closure, a
   * double sale. Allowed at any time before it is completed, and everything paid online goes back to the
   * customer as coins; nobody keeps a share.
   */
  async cancelByStaff(bookingId: string, reason: string | undefined, actor: AuthContext) {
    const booking =
      actor.role === 'SUPER_ADMIN'
        ? await this.getForAdmin(bookingId)
        : await this.getForOwner(bookingId, actor.organizationId!);
    if (actor.role !== 'SUPER_ADMIN') await this.scope.assertVenue(actor, booking.venue.id);
    assertCancellable(booking.status);

    const paidMinor = this.paidOnlineMinor(booking);
    return this.performCancellation(booking, {
      reasonCode: actor.role === 'SUPER_ADMIN' ? 'ADMIN_ACTION' : 'OWNER_ACTION',
      reason,
      actor,
      refund:
        paidMinor > 0
          ? {
              coinMinor: paidMinor,
              paidMinor,
              snapshot: { refundPercent: 100, ownerPercent: 0, cancelledBy: actor.role, coinAmountCredited: fromMinor(paidMinor) },
            }
          : null,
      settlement: null,
    });
  }

  private async performCancellation(
    booking: {
      id: string;
      orderId: string;
      status: string;
      slotHoldId: string;
      customerId: string | null;
      venueId: string;
      currency: string;
      resourceId: string | null;
      resourceGroupId: string | null;
    },
    plan: {
      reasonCode: 'CUSTOMER_REQUESTED' | 'OWNER_ACTION' | 'ADMIN_ACTION';
      reason: string | undefined;
      actor: AuthContext;
      refund: { coinMinor: number; paidMinor: number; snapshot: Prisma.InputJsonObject } | null;
      settlement: Prisma.BookingSettlementUncheckedCreateInput | null;
    },
  ) {
    const result = await this.bookings.cancelAtomic({
      bookingId: booking.id,
      expectedBookingStatus: booking.status,
      slotHoldId: booking.slotHoldId,
      reason: plan.reason,
      reasonCode: plan.reasonCode,
      refundData: plan.refund
        ? {
            originalAmount: fromMinor(plan.refund.paidMinor),
            originalCurrency: booking.currency,
            coinAmountCredited: fromMinor(plan.refund.coinMinor),
            policySnapshot: plan.refund.snapshot,
          }
        : null,
      settlementData: plan.settlement,
    });

    // Completing the refund (actually crediting coins) is a separate
    // call, deliberately outside the transaction above — CoinsService
    // does its own wallet-row locking and shouldn't be composed into an
    // already-open transaction that's also touching Booking/SlotHold/
    // ResourceLock (Refund.PENDING already committed is a safe
    // intermediate state if this second step fails; nothing here can
    // double-credit thanks to the idempotency key).
    if (result.refund) {
      // The response then matches what's in the database (COMPLETED, not the in-transaction PENDING).
      result.refund = await this.coins.completeRefund(result.refund.id);
    }

    await this.audit.record({
      actor: plan.actor,
      action: 'BOOKING_CANCELLED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: {
        reasonCode: plan.reasonCode,
        ...(result.refund
          ? { refundId: result.refund.id, ...plan.refund!.snapshot }
          : { refund: 'none (nothing was paid online)' }),
      },
    });

    // Sent from here, not per-channel, so every cancellation path notifies the same way (§15). Awaited with
    // errors swallowed: a notification failure must never fail the cancellation itself.
    await this.notifyCancellation(booking.customerId, result).catch(() => undefined);

    const venue = await this.bookings.findVenueById(booking.venueId);
    if (venue) {
      await this.notifications
        .notifyOrganizationOwners(
          venue.organizationId,
          {
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
          },
          // The owner who cancelled already knows; their teammates still need to hear.
          { excludeOwnerId: plan.actor.role === 'VENUE_OWNER' ? plan.actor.id : undefined },
        )
        .catch(() => undefined);
    }

    return result;
  }

  private async notifyCancellation(
    customerId: string | null,
    result: { booking: { orderId: string }; refund: { coinAmountCredited: Prisma.Decimal } | null },
  ): Promise<void> {
    // A walk-in has no account, so there is nobody to message.
    if (!customerId) return;
    const customer = await this.bookings.findCustomerById(customerId);
    // WhatsApp goes only to a number the customer has verified, never one that was merely typed in.
    if (!customer?.whatsappNumber || !customer.phoneVerified) return;
    await this.messenger.bookingCancelled(
      customer.whatsappNumber,
      result.booking.orderId,
      result.refund ? result.refund.coinAmountCredited.toString() : undefined,
    );
  }
}

/** A clear 400 for a booking that is already cancelled, completed or a no-show (not an illegal-transition 500). */
function assertCancellable(status: BookingStatus) {
  if (!BOOKING_TRANSITIONS[status]?.includes('CANCELLED')) {
    throw new BadRequestException(
      status === 'CANCELLED' ? 'This booking is already cancelled.' : `A ${status.toLowerCase().replace('_', ' ')} booking can't be cancelled.`,
    );
  }
  assertTransition('Booking', BOOKING_TRANSITIONS, status, 'CANCELLED');
}

function minutesUntil(time: Date): number {
  return (time.getTime() - Date.now()) / 60_000;
}

/** "45 minutes", "1 hour", "48 hours", "1 hour 30 minutes". */
function describeMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (hours === 0) return part(minutes, 'minute');
  return minutes === 0 ? part(hours, 'hour') : `${part(hours, 'hour')} ${part(minutes, 'minute')}`;
}
