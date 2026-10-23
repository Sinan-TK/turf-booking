import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { commercialTermsSchema, commissionTierFor, fromMinor, toMinor } from '@venue/shared';
import { Prisma, type PayoutStatus } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommercialTermsService } from '../commercial/commercial-terms.service';
import type { AuthContext } from '../auth/auth.types';
import { periodMonthOf } from './settlements.service';

const PAYOUT_DETAIL_INCLUDE = {
  organization: { select: { id: true, name: true } },
  settlements: {
    orderBy: { slotStart: 'asc' as const },
    include: {
      booking: { select: { id: true, orderId: true, startTime: true, amount: true, paymentMethod: true } },
      venue: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.PayoutInclude;

/**
 * Weekly owner payouts. On the platform's payout weekday (commercial terms, platform default) every settlement
 * whose slot started before that day (00:00 in the payout timezone) and is not yet in a payout is grouped per
 * organization into one payout. Phase 1 is paid by bank transfer: the admin marks the payout paid with the
 * transfer reference. A paid payout is closed; later settlements wait for the next week's payout.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercialTerms: CommercialTermsService,
  ) {}

  /** The latest payout day at or before `now` (the exclusive end of the week being paid) and the next one. */
  async payoutSchedule(now: Date) {
    const parsed = commercialTermsSchema.safeParse((await this.commercialTerms.getDefault()).terms);
    if (!parsed.success) throw new Error('The platform default commercial terms are missing or invalid.');
    const { payoutWeekday, payoutTimezone } = parsed.data;
    let day = DateTime.fromJSDate(now).setZone(payoutTimezone).startOf('day');
    while (day.weekday !== payoutWeekday) day = day.minus({ days: 1 });
    return { periodEnd: day.toJSDate(), nextPayoutOn: day.plus({ weeks: 1 }).toJSDate(), timezone: payoutTimezone };
  }

  /** Groups every due, unpaid settlement into its organization's payout for the week. Idempotent. */
  @Cron(CronExpression.EVERY_HOUR)
  async createDuePayouts(now: Date = new Date()) {
    const { periodEnd } = await this.payoutSchedule(now);
    const groups = await this.prisma.client.bookingSettlement.groupBy({
      by: ['organizationId', 'currency'],
      where: { payoutId: null, slotStart: { lt: periodEnd } },
    });
    const touched = [];
    for (const g of groups) {
      const payout = await this.prisma.client.$transaction(async (tx) => {
        const key = { organizationId: g.organizationId, periodEnd, currency: g.currency };
        const row = await tx.payout.upsert({
          where: { organizationId_periodEnd_currency: key },
          update: {},
          create: { ...key, totalOwnerAmount: 0, settlementCount: 0 },
        });
        if (row.status === 'PAID') return null;
        await tx.bookingSettlement.updateMany({
          where: { payoutId: null, organizationId: g.organizationId, currency: g.currency, slotStart: { lt: periodEnd } },
          data: { payoutId: row.id },
        });
        const totals = await tx.bookingSettlement.aggregate({
          where: { payoutId: row.id },
          _sum: { ownerAmount: true },
          _count: true,
        });
        return tx.payout.update({
          where: { id: row.id },
          data: { totalOwnerAmount: totals._sum.ownerAmount ?? 0, settlementCount: totals._count },
        });
      });
      if (payout) touched.push(payout);
    }
    if (touched.length > 0) {
      this.logger.log(`Prepared ${touched.length} payout(s) for the week ending ${periodEnd.toISOString()}`);
      await this.audit.record({
        actor: 'SYSTEM',
        action: 'PAYOUTS_PREPARED',
        entityType: 'Payout',
        entityId: touched[0]!.id,
        metadata: { periodEnd: periodEnd.toISOString(), payoutIds: touched.map((p) => p.id) },
      });
    }
    return touched;
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  private adminWhere(filters: { status?: PayoutStatus; organizationId?: string }): Prisma.PayoutWhereInput {
    return { status: filters.status, organizationId: filters.organizationId };
  }

  listForAdmin(filters: { status?: PayoutStatus; organizationId?: string; limit: number; offset: number }) {
    return this.prisma.client.payout.findMany({
      where: this.adminWhere(filters),
      include: { organization: { select: { id: true, name: true } } },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
      skip: filters.offset,
    });
  }

  countForAdmin(filters: { status?: PayoutStatus; organizationId?: string }) {
    return this.prisma.client.payout.count({ where: this.adminWhere(filters) });
  }

  async getForAdmin(id: string) {
    const payout = await this.prisma.client.payout.findUnique({ where: { id }, include: PAYOUT_DETAIL_INCLUDE });
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  /** The admin has transferred the money: record the bank reference. */
  async markPaid(id: string, reference: string, actor: AuthContext) {
    const payout = await this.prisma.client.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status === 'PAID') throw new BadRequestException('This payout is already marked as paid.');
    const updated = await this.prisma.client.payout.update({
      where: { id, status: 'PENDING' },
      data: { status: 'PAID', reference, paidAt: new Date(), paidByAdminId: actor.id },
    });
    await this.audit.record({
      actor,
      action: 'PAYOUT_MARKED_PAID',
      entityType: 'Payout',
      entityId: id,
      metadata: { reference, totalOwnerAmount: updated.totalOwnerAmount.toString() },
    });
    return updated;
  }

  /** Platform totals for the admin dashboard. */
  async platformSummary(now: Date = new Date()) {
    const { timezone } = await this.payoutSchedule(now);
    const monthStart = DateTime.fromJSDate(now).setZone(timezone).startOf('month').toJSDate();
    const [coins, month, pending] = await Promise.all([
      this.prisma.client.coinWallet.aggregate({ _sum: { cachedBalance: true } }),
      this.prisma.client.bookingSettlement.aggregate({
        where: { slotStart: { gte: monthStart } },
        _sum: { platformAmount: true, commission: true, fee: true },
      }),
      this.prisma.client.payout.aggregate({ where: { status: 'PENDING' }, _sum: { totalOwnerAmount: true }, _count: true }),
    ]);
    return {
      coinsOutstanding: (coins._sum.cachedBalance ?? new Prisma.Decimal(0)).toString(),
      platformEarningsThisMonth: (month._sum.platformAmount ?? new Prisma.Decimal(0)).toString(),
      commissionThisMonth: (month._sum.commission ?? new Prisma.Decimal(0)).toString(),
      feesThisMonth: (month._sum.fee ?? new Prisma.Decimal(0)).toString(),
      pendingPayouts: { count: pending._count, total: (pending._sum.totalOwnerAmount ?? new Prisma.Decimal(0)).toString() },
    };
  }

  // ---------------------------------------------------------------------------
  // Owner
  // ---------------------------------------------------------------------------

  listForOwner(organizationId: string, page: { limit: number; offset: number }) {
    return this.prisma.client.payout.findMany({
      where: { organizationId },
      orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
      take: page.limit,
      skip: page.offset,
    });
  }

  countForOwner(organizationId: string) {
    return this.prisma.client.payout.count({ where: { organizationId } });
  }

  async getForOwner(id: string, organizationId: string) {
    const payout = await this.getForAdmin(id);
    if (payout.organizationId !== organizationId) throw new ForbiddenException("Cannot access another organization's payout");
    return payout;
  }

  /**
   * The owner's earnings at a glance: per venue and facility this month — bookings settled, commission paid,
   * the cap and what is left of it, the rate the next booking pays — plus money waiting for the next payout.
   */
  async earningsForOwner(organizationId: string, now: Date = new Date()) {
    const venues = await this.prisma.client.venue.findMany({
      where: { organizationId, deletedAt: null },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    });
    const facilities = [];
    for (const venue of venues) {
      const month = periodMonthOf(now, venue.timezone);
      const [terms, counters] = await Promise.all([
        this.commercialTerms.listForVenue(venue.id),
        this.prisma.client.venueCommissionMonth.findMany({ where: { venueId: venue.id, periodMonth: month } }),
      ]);
      for (const f of terms) {
        const counter = counters.find((c) => c.categoryId === f.categoryId);
        const bookings = counter?.bookingCount ?? 0;
        const commissionMinor = toMinor(counter?.commissionTotal.toString() ?? 0);
        const cap = f.terms.monthlyCommissionCap;
        const capReached = cap !== null && commissionMinor >= toMinor(cap);
        facilities.push({
          venueId: venue.id,
          venueName: venue.name,
          categoryId: f.categoryId,
          facility: f.name,
          month,
          bookings,
          commission: fromMinor(commissionMinor),
          monthlyCommissionCap: cap === null ? null : fromMinor(toMinor(cap)),
          capRemaining: cap === null ? null : fromMinor(Math.max(0, toMinor(cap) - commissionMinor)),
          capReached,
          // What the next settled booking pays.
          nextCommission: capReached ? null : commissionTierFor(f.terms.commissionTiers, bookings + 1),
          afterCapFeePercent: f.terms.afterCapFeePercent,
        });
      }
    }
    const [unpaid, pending, lastPaid, schedule] = await Promise.all([
      this.prisma.client.bookingSettlement.aggregate({
        where: { organizationId, payoutId: null },
        _sum: { ownerAmount: true },
        _count: true,
      }),
      this.prisma.client.payout.aggregate({
        where: { organizationId, status: 'PENDING' },
        _sum: { totalOwnerAmount: true },
        _count: true,
      }),
      this.prisma.client.payout.findFirst({ where: { organizationId, status: 'PAID' }, orderBy: { paidAt: 'desc' } }),
      this.payoutSchedule(now),
    ]);
    return {
      facilities,
      notYetInPayout: { count: unpaid._count, total: (unpaid._sum.ownerAmount ?? new Prisma.Decimal(0)).toString() },
      pendingPayouts: { count: pending._count, total: (pending._sum.totalOwnerAmount ?? new Prisma.Decimal(0)).toString() },
      lastPayout: lastPaid,
      nextPayoutOn: schedule.nextPayoutOn,
    };
  }
}
