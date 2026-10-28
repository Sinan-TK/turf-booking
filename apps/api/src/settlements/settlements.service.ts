import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import {
  BOOKING_TRANSITIONS,
  assertTransition,
  commercialTermsSchema,
  fromMinor,
  settlePlayedBooking,
  toMinor,
  type CancellationOutcome,
  type CommercialTerms,
} from '@venue/shared';
import { Prisma } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/** What a settlement needs to know about its booking. */
const SETTLEMENT_BOOKING_INCLUDE = {
  venue: { select: { organizationId: true, timezone: true } },
  resource: { select: { categoryId: true } },
  resourceGroup: { select: { categoryId: true } },
  payments: { where: { status: 'SUCCESS' as const } },
  settlement: { select: { id: true } },
} satisfies Prisma.BookingInclude;
type SettlementBooking = Prisma.BookingGetPayload<{ include: typeof SETTLEMENT_BOOKING_INCLUDE }>;

/** The month a booking counts in for caps and tiers: its start, in the venue's own calendar. */
export function periodMonthOf(startTime: Date, timezone: string): string {
  return DateTime.fromJSDate(startTime).setZone(timezone).toFormat('yyyy-MM');
}

/** The first instant of the month after `periodMonth` ("2026-10"), in the venue's own timezone: when its caps and tiers start over. */
export function nextMonthStart(periodMonth: string, timezone: string): Date {
  return DateTime.fromFormat(periodMonth, 'yyyy-MM', { zone: timezone }).plus({ months: 1 }).startOf('month').toJSDate();
}

/**
 * Splits what was collected online for each booking between the owner and the platform:
 *  - played and no-show bookings, once their slot has ended (commission by the month's tier, limited by the
 *    monthly cap, then the after-cap fee), and
 *  - late cancellations, at cancel time (see `lateCancelData`).
 * All numbers come from the commercial terms snapshotted on the booking when it was made. Bookings made before
 * commercial terms existed (no snapshot) and walk-ins are never settled: nothing was agreed for them.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The settlement row for a late cancellation, written inside the cancellation's own transaction. */
  lateCancelData(
    booking: {
      id: string;
      venueId: string;
      startTime: Date;
      currency: string;
      commercialTerms: Prisma.JsonValue;
    },
    context: { organizationId: string; timezone: string; categoryId: string },
    collectedMinor: number,
    outcome: Extract<CancellationOutcome, { allowed: true }>,
    minutesBeforeStart: number,
  ): Prisma.BookingSettlementUncheckedCreateInput | null {
    // Nothing to split: everything went back as coins, or the booking predates commercial terms.
    if (outcome.refundMinor >= collectedMinor || !booking.commercialTerms) return null;
    return {
      bookingId: booking.id,
      organizationId: context.organizationId,
      venueId: booking.venueId,
      categoryId: context.categoryId,
      kind: 'LATE_CANCEL',
      slotStart: booking.startTime,
      periodMonth: periodMonthOf(booking.startTime, context.timezone),
      currency: booking.currency,
      collected: fromMinor(collectedMinor),
      commission: 0,
      fee: 0,
      refunded: fromMinor(outcome.refundMinor),
      ownerAmount: fromMinor(outcome.ownerMinor),
      platformAmount: fromMinor(outcome.platformMinor),
      details: { tier: outcome.tier, minutesBeforeStart: Math.round(minutesBeforeStart) },
    };
  }

  /**
   * Marks confirmed bookings whose slot has ended as COMPLETED, then settles every played / no-show booking
   * that has no settlement yet, oldest slot first (so tiers and the cap count bookings in slot order).
   * Idempotent: safe to run repeatedly or concurrently.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async completeAndSettle(now: Date = new Date()) {
    const ended = await this.prisma.client.booking.findMany({
      where: { status: 'CONFIRMED', endTime: { lte: now } },
      select: { id: true, status: true },
      orderBy: { startTime: 'asc' },
      take: 1000,
    });
    for (const b of ended) {
      assertTransition('Booking', BOOKING_TRANSITIONS, b.status, 'COMPLETED');
      await this.prisma.client.booking.updateMany({ where: { id: b.id, status: 'CONFIRMED' }, data: { status: 'COMPLETED' } });
    }

    const toSettle = await this.prisma.client.booking.findMany({
      where: {
        status: { in: ['COMPLETED', 'NO_SHOW'] },
        endTime: { lte: now },
        settlement: null,
        paymentMethod: { in: ['MONEY', 'COINS'] },
        commercialTerms: { not: Prisma.DbNull },
      },
      include: SETTLEMENT_BOOKING_INCLUDE,
      orderBy: { startTime: 'asc' },
      take: 1000,
    });
    let settled = 0;
    for (const booking of toSettle) {
      if (await this.settlePlayed(booking)) settled++;
    }
    if (ended.length || settled) this.logger.log(`Completed ${ended.length} booking(s), settled ${settled}`);
    return { completed: ended.length, settled };
  }

  private async settlePlayed(booking: SettlementBooking) {
    const parsed = commercialTermsSchema.safeParse(booking.commercialTerms);
    if (!parsed.success) {
      this.logger.error(`Booking ${booking.id} has unreadable commercial terms; not settled`);
      return null;
    }
    const terms: CommercialTerms = parsed.data;
    const categoryId = booking.resource?.categoryId ?? booking.resourceGroup?.categoryId;
    if (!categoryId) return null;
    const collectedMinor = booking.payments
      .filter((p) => p.provider === 'RAZORPAY' || p.provider === 'COINS')
      .reduce((sum, p) => sum + toMinor(p.amount.toString()), 0);
    if (collectedMinor <= 0) return null;

    const periodMonth = periodMonthOf(booking.startTime, booking.venue.timezone);
    const key = { venueId: booking.venueId, categoryId, periodMonth };
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO venue_commission_months ("venueId", "categoryId", "periodMonth", "bookingCount", "commissionTotal", "updatedAt")
          VALUES (${key.venueId}::uuid, ${key.categoryId}::uuid, ${key.periodMonth}, 0, 0, NOW())
          ON CONFLICT DO NOTHING`;
        // Serializes settlements of one venue + facility + month, so two can never both slip under the cap.
        const [counter] = await tx.$queryRaw<Array<{ bookingCount: number; commissionTotal: Prisma.Decimal }>>`
          SELECT "bookingCount", "commissionTotal" FROM venue_commission_months
          WHERE "venueId" = ${key.venueId}::uuid AND "categoryId" = ${key.categoryId}::uuid AND "periodMonth" = ${key.periodMonth}
          FOR UPDATE`;
        const r = settlePlayedBooking({
          fullPriceMinor: toMinor(booking.amount.toString()),
          collectedMinor,
          bookingsBefore: counter!.bookingCount,
          commissionBeforeMinor: toMinor(counter!.commissionTotal.toString()),
          terms,
        });
        const settlement = await tx.bookingSettlement.create({
          data: {
            bookingId: booking.id,
            organizationId: booking.venue.organizationId,
            venueId: booking.venueId,
            categoryId,
            kind: booking.status === 'NO_SHOW' ? 'NO_SHOW' : 'PLAYED',
            slotStart: booking.startTime,
            periodMonth,
            currency: booking.currency,
            collected: fromMinor(collectedMinor),
            commission: fromMinor(r.commissionMinor),
            fee: fromMinor(r.feeMinor),
            ownerAmount: fromMinor(r.ownerMinor),
            platformAmount: fromMinor(r.platformMinor),
            details: {
              bookingNumber: r.bookingNumber,
              tier: r.tier,
              capReachedBefore: r.capReachedBefore,
              monthlyCommissionCap: terms.monthlyCommissionCap,
              afterCapFeePercent: terms.afterCapFeePercent,
              commissionBefore: counter!.commissionTotal.toString(),
            },
          },
        });
        await tx.venueCommissionMonth.update({
          where: { venueId_categoryId_periodMonth: key },
          data: { bookingCount: { increment: 1 }, commissionTotal: { increment: fromMinor(r.commissionMinor) } },
        });
        return settlement;
      });
    } catch (error) {
      // Settled concurrently by another run: the unique bookingId kept it to one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  /** The settlement data the cancellation flow needs about a booking's venue and facility. */
  async contextOf(booking: { venueId: string; resourceId: string | null; resourceGroupId: string | null }) {
    const [venue, unit] = await Promise.all([
      this.prisma.client.venue.findUniqueOrThrow({
        where: { id: booking.venueId },
        select: { organizationId: true, timezone: true },
      }),
      booking.resourceId
        ? this.prisma.client.resource.findUniqueOrThrow({ where: { id: booking.resourceId }, select: { categoryId: true } })
        : this.prisma.client.resourceGroup.findUniqueOrThrow({
            where: { id: booking.resourceGroupId! },
            select: { categoryId: true },
          }),
    ]);
    return { organizationId: venue.organizationId, timezone: venue.timezone, categoryId: unit.categoryId };
  }

  /** For audits: record a system run. */
  async recordRun(action: string, metadata: Prisma.InputJsonValue) {
    await this.audit.record({ actor: 'SYSTEM', action, entityType: 'Settlement', entityId: 'batch', metadata });
  }
}
