import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { commercialTermsSchema, commissionTierFor, effectiveMonthlyCap, fromMinor, toMinor } from '@venue/shared';
import { Prisma, type PayoutStatus, type SettlementKind } from '@venue/database';
import { contains, dateWhere, type DateRange } from '../common/list-filters';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommercialTermsService } from '../commercial/commercial-terms.service';
import type { AuthContext } from '../auth/auth.types';
import { nextMonthStart, periodMonthOf } from './settlements.service';

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
        // Lock the payout while it is filled, so it cannot be marked paid half way through (a paid payout never changes).
        const locked = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text AS status FROM payouts WHERE id = ${row.id}::uuid FOR UPDATE`;
        if (row.status === 'PAID' || locked[0]?.status === 'PAID') return null;
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
    // Where to send the money, and whether the admin has checked it. Not a reason to refuse paying: the admin sees the warning.
    const bankAccount = await this.prisma.client.organizationBankAccount.findUnique({ where: { organizationId: payout.organization.id } });
    return { ...payout, bankAccount };
  }

  /**
   * The admin has transferred the money: record the bank reference. When the admin says which amount they reviewed
   * (`expectedTotal`), the payout is only closed if it still has exactly that total: a late settlement can join an unpaid payout,
   * and the transfer would then not match what is recorded. The check and the change are one atomic update, so two admins paying at
   * the same moment cannot both succeed, and nothing can slip in between.
   */
  async markPaid(id: string, reference: string, actor: AuthContext, expectedTotal?: string) {
    const payout = await this.prisma.client.payout.findUnique({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');
    if (payout.status === 'PAID') throw new BadRequestException('This payout is already marked as paid.');
    if (expectedTotal !== undefined && !/^\d+(\.\d{1,2})?$/.test(expectedTotal)) {
      throw new BadRequestException('The reviewed amount is not a valid amount.');
    }
    const closed = await this.prisma.client.payout.updateMany({
      where: { id, status: 'PENDING', ...(expectedTotal !== undefined ? { totalOwnerAmount: new Prisma.Decimal(expectedTotal) } : {}) },
      data: { status: 'PAID', reference, paidAt: new Date(), paidByAdminId: actor.id },
    });
    if (closed.count === 0) {
      const now = await this.prisma.client.payout.findUniqueOrThrow({ where: { id } });
      if (now.status === 'PAID') throw new BadRequestException('This payout is already marked as paid.');
      throw new ConflictException(
        `This payout changed after you opened it: it is now ${fromMinor(toMinor(now.totalOwnerAmount.toString()))} for ${now.settlementCount} booking(s). Review it again before paying.`,
      );
    }
    const updated = await this.prisma.client.payout.findUniqueOrThrow({ where: { id } });
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
   * This month's commission usage for every facility of the given venues: bookings settled, commission paid, the cap and what
   * is left of it, the rate the next booking pays, and when the month (and so the cap and the tiers) starts over. The month is
   * each venue's own calendar month. Terms and counters are read in a few queries, not several per venue.
   */
  async monthUsage(venues: Array<{ id: string; name: string; timezone: string }>, now: Date) {
    const termsByVenue = await this.commercialTerms.listForVenues(venues.map((v) => v.id));
    const monthOf = new Map(venues.map((v) => [v.id, periodMonthOf(now, v.timezone)]));
    const countersByMonth = new Map<string, Awaited<ReturnType<typeof this.prisma.client.venueCommissionMonth.findMany>>>();
    await Promise.all(
      [...new Set(monthOf.values())].map(async (month) => {
        const ids = venues.filter((v) => monthOf.get(v.id) === month).map((v) => v.id);
        countersByMonth.set(month, await this.prisma.client.venueCommissionMonth.findMany({ where: { venueId: { in: ids }, periodMonth: month } }));
      }),
    );
    // Units per venue + facility: the cap is multiplied by it (unless the terms turn that off).
    const unitsOf = new Map<string, number>();
    const venueIds = venues.map((v) => v.id);
    const [resourceCounts, groupCounts] = await Promise.all([
      this.prisma.client.resource.groupBy({ by: ['venueId', 'categoryId'], where: { venueId: { in: venueIds }, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.client.resourceGroup.groupBy({ by: ['venueId', 'categoryId'], where: { venueId: { in: venueIds } }, _count: { _all: true } }),
    ]);
    for (const row of [...resourceCounts, ...groupCounts]) {
      const k = `${row.venueId}:${row.categoryId}`;
      unitsOf.set(k, (unitsOf.get(k) ?? 0) + row._count._all);
    }
    const usage = [];
    for (const venue of venues) {
      const month = monthOf.get(venue.id)!;
      const terms = termsByVenue.get(venue.id) ?? [];
      const counters = (countersByMonth.get(month) ?? []).filter((c) => c.venueId === venue.id);
      for (const f of terms) {
        const counter = counters.find((c) => c.categoryId === f.categoryId);
        const bookings = counter?.bookingCount ?? 0;
        const commissionMinor = toMinor(counter?.commissionTotal.toString() ?? 0);
        const units = Math.max(1, unitsOf.get(`${venue.id}:${f.categoryId}`) ?? 0);
        const cap = effectiveMonthlyCap(f.terms, units);
        const capReached = cap !== null && commissionMinor >= toMinor(cap);
        usage.push({
          venueId: venue.id,
          venueName: venue.name,
          categoryId: f.categoryId,
          facility: f.name,
          month,
          // When this month ends: the cap and the booking count (and so the commission tier) start again then.
          resetsOn: nextMonthStart(month, venue.timezone).toISOString(),
          bookings,
          commission: fromMinor(commissionMinor),
          monthlyCommissionCap: cap === null ? null : fromMinor(toMinor(cap)),
          // The cap for one unit, and how many units it was multiplied by (1 when capPerUnit is off).
          capPerUnit: f.terms.monthlyCommissionCap === null ? null : fromMinor(toMinor(f.terms.monthlyCommissionCap)),
          capUnits: f.terms.capPerUnit === false ? 1 : units,
          capRemaining: cap === null ? null : fromMinor(Math.max(0, toMinor(cap) - commissionMinor)),
          capReached,
          // What the next settled booking pays.
          nextCommission: capReached ? null : commissionTierFor(f.terms.commissionTiers, bookings + 1),
          afterCapFeePercent: f.terms.afterCapFeePercent,
        });
      }
    }
    return usage;
  }

  /** One venue's facilities with this month's commission usage (the Super Admin's view of a venue's caps). */
  async usageForVenue(venueId: string, now: Date = new Date()) {
    const venue = await this.prisma.client.venue.findUnique({
      where: { id: venueId },
      select: { id: true, name: true, timezone: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    return this.monthUsage([venue], now);
  }

  /**
   * What an organisation earned in a period, in total, by venue and by facility. A settled booking counts in the period its slot
   * started in. Every venue and facility the owner has is listed, with zeros where nothing was settled, so the lists are complete.
   * `collected` is what customers paid online, `platform` what the platform kept (commission, fees and the platform's share of
   * late cancellations), `refunded` what went back to customers, and `earned` what is the owner's.
   */
  async earningsBreakdown(organizationId: string, range: DateRange) {
    const where: Prisma.BookingSettlementWhereInput = { organizationId, slotStart: dateWhere(range) };
    const sums = { collected: true, platformAmount: true, refunded: true, ownerAmount: true } as const;
    const [total, byVenue, byCategory, venues, units] = await Promise.all([
      this.prisma.client.bookingSettlement.aggregate({ where, _sum: sums, _count: true }),
      this.prisma.client.bookingSettlement.groupBy({ by: ['venueId'], where, _sum: sums, _count: true }),
      this.prisma.client.bookingSettlement.groupBy({ by: ['categoryId'], where, _sum: sums, _count: true }),
      this.prisma.client.venue.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.client.resource.findMany({ where: { venue: { organizationId, deletedAt: null } }, select: { categoryId: true, venueId: true }, distinct: ['categoryId', 'venueId'] }),
    ]);
    const categoryIds = [...new Set([...byCategory.map((c) => c.categoryId), ...units.map((u) => u.categoryId)])];
    const categories = await this.prisma.client.venueCategory.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, iconKey: true, iconSvg: true },
      orderBy: { name: 'asc' },
    });
    const zero = new Prisma.Decimal(0);
    const figures = (row?: { _sum: { collected: Prisma.Decimal | null; platformAmount: Prisma.Decimal | null; refunded: Prisma.Decimal | null; ownerAmount: Prisma.Decimal | null }; _count: number | { _all: number } }) => ({
      bookings: typeof row?._count === 'number' ? row._count : (row?._count as { _all: number } | undefined)?._all ?? 0,
      collected: (row?._sum.collected ?? zero).toString(),
      platform: (row?._sum.platformAmount ?? zero).toString(),
      refunded: (row?._sum.refunded ?? zero).toString(),
      earned: (row?._sum.ownerAmount ?? zero).toString(),
    });
    const venueRow = new Map(byVenue.map((r) => [r.venueId, r]));
    const categoryRow = new Map(byCategory.map((r) => [r.categoryId, r]));
    const facilitiesOf = new Map<string, number>();
    for (const u of units) facilitiesOf.set(u.venueId, (facilitiesOf.get(u.venueId) ?? 0) + 1);
    return {
      total: figures(total),
      byVenue: venues.map((v) => ({ id: v.id, name: v.name, facilities: facilitiesOf.get(v.id) ?? 0, ...figures(venueRow.get(v.id)) })),
      byFacility: categories.map((c) => ({ ...c, venues: units.filter((u) => u.categoryId === c.id).length, ...figures(categoryRow.get(c.id)) })),
    };
  }

  private settlementWhere(
    organizationId: string,
    f: { search?: string; venueId?: string; categoryId?: string; kind?: SettlementKind; range?: DateRange },
  ): Prisma.BookingSettlementWhereInput {
    return {
      organizationId,
      venueId: f.venueId,
      categoryId: f.categoryId,
      kind: f.kind,
      slotStart: dateWhere(f.range),
      ...(f.search ? { booking: { orderId: contains(f.search) } } : {}),
    };
  }

  countSettlementsForOwner(organizationId: string, f: Parameters<PayoutsService['settlementWhere']>[1]) {
    return this.prisma.client.bookingSettlement.count({ where: this.settlementWhere(organizationId, f) });
  }

  /** The bookings behind the earnings, newest slot first, each with what was paid, what the platform kept and what is the owner's. */
  listSettlementsForOwner(organizationId: string, f: Parameters<PayoutsService['settlementWhere']>[1] & { limit: number; offset: number }) {
    return this.prisma.client.bookingSettlement.findMany({
      where: this.settlementWhere(organizationId, f),
      select: {
        id: true,
        kind: true,
        slotStart: true,
        currency: true,
        collected: true,
        commission: true,
        fee: true,
        refunded: true,
        platformAmount: true,
        ownerAmount: true,
        booking: { select: { id: true, orderId: true } },
        venue: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        payout: { select: { id: true, status: true } },
      },
      orderBy: [{ slotStart: 'desc' }, { id: 'desc' }],
      take: f.limit,
      skip: f.offset,
    });
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
    const facilities = await this.monthUsage(venues, now);
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
