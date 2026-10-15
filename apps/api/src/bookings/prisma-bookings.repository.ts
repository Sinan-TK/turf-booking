import { ConflictException, Injectable } from '@nestjs/common';
import { formatOrderId, SLOT_HOLD_TRANSITIONS, assertTransition } from '@venue/shared';
import type { BookingStatus, DayType } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import type {
  BookingsRepository,
  CancelAtomicParams,
  HoldAtomicParams,
  OfflineAtomicParams,
  PooledHoldAtomicParams,
} from './bookings.repository';

/**
 * Prisma-backed BookingsRepository. The ONLY file in the bookings module
 * allowed to touch PrismaService. Query shapes are moved verbatim from
 * BookingsService — including the three $transaction blocks, which must
 * stay atomic for the ResourceLock exclusion constraint to guard races.
 *
 * The SlotHold RELEASED assert inside cancelAtomic runs on data read
 * within the same transaction (it cannot be checked before the tx opens
 * without a race); all other transition asserts stay in the service.
 */
@Injectable()
export class PrismaBookingsRepository implements BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findResourceById(id: string) {
    return this.prisma.client.resource.findUnique({ where: { id } });
  }

  findVenueById(id: string) {
    return this.prisma.client.venue.findUnique({ where: { id } });
  }

  findOverlappingLock(footprintIds: string[], startTime: Date, endTime: Date) {
    return this.prisma.client.resourceLock.findFirst({
      where: {
        resourceId: { in: footprintIds },
        status: { in: ['HELD', 'CONFIRMED'] },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
  }

  findPricingRule(resourceId: string, durationMinutes: number, dayType: string, at: Date) {
    return this.prisma.client.pricingRule.findFirst({
      where: { resourceId, durationMinutes, dayType: dayType as DayType, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findResourceGroupById(id: string) {
    return this.prisma.client.resourceGroup.findUnique({ where: { id } });
  }

  findGroupPricingRule(resourceGroupId: string, durationMinutes: number, dayType: string, at: Date) {
    return this.prisma.client.pricingRule.findFirst({
      where: {
        resourceGroupId,
        durationMinutes,
        dayType: dayType as DayType,
        effectiveFrom: { lte: at },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Overlapping HELD/CONFIRMED quantity for a pooled group — the read
   * half of the capacity check. Authoritative enforcement happens inside
   * createPooledHoldAtomic (row lock + re-check); this is the fast-fail
   * pre-check and the availability read, mirroring findOverlappingLock.
   */
  async sumHeldGroupQuantity(resourceGroupId: string, startTime: Date, endTime: Date) {
    const [row] = await this.prisma.client.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(quantity), 0)::bigint AS total
      FROM inventory_reservations
      WHERE "resourceGroupId" = ${resourceGroupId}::uuid
        AND status IN ('HELD', 'CONFIRMED')
        AND "startTime" < ${endTime}
        AND "endTime" > ${startTime}
    `;
    return Number(row?.total ?? 0);
  }

  findInventoryReservations(slotHoldId: string) {
    return this.prisma.client.inventoryReservation.findMany({ where: { slotHoldId } });
  }

  findBookingById(id: string) {
    return this.prisma.client.booking.findUnique({ where: { id } });
  }

  findBookingDetailById(id: string) {
    return this.prisma.client.booking.findUnique({
      where: { id },
      include: {
        venue: { select: { id: true, name: true, facilityCode: true, organizationId: true } },
        resourceGroup: {
          select: { id: true, name: true, allocationMode: true, totalUnits: true },
        },
        customer: { select: { id: true, whatsappNumber: true, name: true } },
        payments: true,
        refunds: true,
      },
    });
  }

  listForCustomer(customerId: string) {
    return this.prisma.client.booking.findMany({
      where: { customerId },
      orderBy: { startTime: 'desc' },
    });
  }

  listForAdmin(filters: { status?: string; venueId?: string; organizationId?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.booking.findMany({
      where: {
        status: filters.status ? (filters.status as BookingStatus) : undefined,
        venueId: filters.venueId,
        venue: filters.organizationId ? { organizationId: filters.organizationId } : undefined,
      },
      include: {
        venue: { select: { id: true, name: true, facilityCode: true, organizationId: true } },
        customer: { select: { id: true, whatsappNumber: true, name: true } },
      },
      orderBy: { startTime: 'desc' },
      take: limit,
    });
  }

  listForOwner(
    organizationId: string,
    filters: { status?: string; venueId?: string; limit?: number },
  ) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.booking.findMany({
      where: {
        status: filters.status ? (filters.status as BookingStatus) : undefined,
        venueId: filters.venueId,
        venue: { organizationId },
      },
      include: {
        venue: { select: { id: true, name: true, facilityCode: true, organizationId: true } },
        customer: { select: { id: true, whatsappNumber: true, name: true } },
      },
      orderBy: { startTime: 'desc' },
      take: limit,
    });
  }

  findCustomerById(id: string) {
    return this.prisma.client.customerProfile.findUnique({ where: { id } });
  }

  async createHoldAtomic(params: HoldAtomicParams) {
    return this.prisma.client.$transaction(async (tx) => {
      const slotHold = await tx.slotHold.create({
        data: {
          resourceId: params.resourceId,
          customerId: params.customerId,
          startTime: params.startTime,
          endTime: params.endTime,
          holdExpiresAt: params.holdExpiresAt,
          priceSnapshot: params.priceSnapshot,
        },
      });

      // One ResourceLock per resource in the footprint set — this, not
      // SlotHold itself, is what the exclusion constraint guards.
      await tx.resourceLock.createMany({
        data: params.footprintIds.map((resourceId) => ({
          slotHoldId: slotHold.id,
          resourceId,
          // Booking time + policy buffers: the GiST exclusion constraint on
          // this range is what enforces the required gap between bookings.
          startTime: params.lockStartTime,
          endTime: params.lockEndTime,
        })),
      });

      const [{ nextval }] = await tx.$queryRaw<
        Array<{ nextval: bigint }>
      >`SELECT nextval('booking_order_seq')`;
      const orderId = formatOrderId(nextval);

      return tx.booking.create({
        data: {
          orderSeq: nextval,
          orderId,
          slotHoldId: slotHold.id,
          customerId: params.customerId,
          venueId: params.venueId,
          resourceId: params.resourceId,
          startTime: params.startTime,
          endTime: params.endTime,
          durationMinutes: params.durationMinutes,
          groundType: params.groundType,
          amount: params.amount,
          currency: params.currency,
        },
      });
    });
  }

  /**
   * P2 pooled hold: locks the ResourceGroup row first so concurrent
   * transactions serialize on it, re-checks the overlapping
   * HELD/CONFIRMED quantity inside the same transaction (the pre-check
   * in the service is only a fast fail with a race window), and only
   * then writes SlotHold + InventoryReservation + Booking. Oversell —
   * including a race lost between pre-check and this lock — throws a
   * ConflictException the service passes through as the 409, the same
   * contract as the exclusion-constraint path.
   */
  async createPooledHoldAtomic(params: PooledHoldAtomicParams) {
    return this.prisma.client.$transaction(async (tx) => {
      // Two statements, deliberately NOT fused into one: the row lock
      // must be a plain SELECT ... FOR UPDATE, and the capacity SUM a
      // separate command issued only after the lock is held. Fusing the
      // SUM in as a SELECT-list subquery returns STALE sums under
      // READ COMMITTED — a contender unblocked by a commit re-reads the
      // locked row but not the already-evaluated subquery, so every
      // racer sees the pre-race total and the pool oversells (caught
      // live: 20/20 concurrent holds succeeded against capacity 10).
      // The separate SUM takes a fresh snapshot that includes every
      // transaction committed ahead of us in the lock queue.
      const [group] = await tx.$queryRaw<Array<{ id: string; totalUnits: number | null }>>`
        SELECT id, "totalUnits" FROM resource_groups WHERE id = ${params.resourceGroupId}::uuid FOR UPDATE
      `;
      if (!group || group.totalUnits == null) {
        throw new ConflictException('This inventory pool is not configured for booking.');
      }

      const [held] = await tx.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(quantity), 0)::bigint AS total
        FROM inventory_reservations
        WHERE "resourceGroupId" = ${params.resourceGroupId}::uuid
          AND status IN ('HELD', 'CONFIRMED')
          AND "startTime" < ${params.endTime}
          AND "endTime" > ${params.startTime}
      `;
      if (Number(held?.total ?? 0) + params.quantity > group.totalUnits) {
        throw new ConflictException(
          'Not enough units available for this time. Please reduce the quantity or choose another time.',
        );
      }

      const slotHold = await tx.slotHold.create({
        data: {
          resourceId: null,
          resourceGroupId: params.resourceGroupId,
          quantity: params.quantity,
          customerId: params.customerId,
          startTime: params.startTime,
          endTime: params.endTime,
          holdExpiresAt: params.holdExpiresAt,
          priceSnapshot: params.priceSnapshot,
        },
      });

      await tx.inventoryReservation.create({
        data: {
          slotHoldId: slotHold.id,
          resourceGroupId: params.resourceGroupId,
          quantity: params.quantity,
          startTime: params.startTime,
          endTime: params.endTime,
        },
      });

      const [{ nextval }] = await tx.$queryRaw<
        Array<{ nextval: bigint }>
      >`SELECT nextval('booking_order_seq')`;
      const orderId = formatOrderId(nextval);

      return tx.booking.create({
        data: {
          orderSeq: nextval,
          orderId,
          slotHoldId: slotHold.id,
          customerId: params.customerId,
          venueId: params.venueId,
          resourceId: null,
          resourceGroupId: params.resourceGroupId,
          quantity: params.quantity,
          startTime: params.startTime,
          endTime: params.endTime,
          durationMinutes: params.durationMinutes,
          groundType: params.unitLabel,
          amount: params.amount,
          currency: params.currency,
        },
      });
      // Contenders queue on the group's row lock and the clock starts at
      // transaction begin, so under a burst the wait alone can exceed
      // Prisma's 5s default (seen against a remote Neon DB: 20 racers on
      // ~6 round trips each). A timed-out racer surfaces as a 500, not a
      // clean 409, so give the queue room.
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  async createOfflineAtomic(params: OfflineAtomicParams) {
    return this.prisma.client.$transaction(async (tx) => {
      const slotHold = await tx.slotHold.create({
        data: {
          resourceId: params.resourceId,
          customerId: params.customerId,
          startTime: params.startTime,
          endTime: params.endTime,
          status: 'CONFIRMED',
          holdExpiresAt: params.endTime, // irrelevant once CONFIRMED; the sweep only acts on HELD
          priceSnapshot: {
            amount: String(params.amount),
            currency: params.currency,
            durationMinutes: params.durationMinutes,
          },
        },
      });

      await tx.resourceLock.createMany({
        data: params.footprintIds.map((resourceId) => ({
          slotHoldId: slotHold.id,
          resourceId,
          // Booking time + policy buffers: the GiST exclusion constraint on
          // this range is what enforces the required gap between bookings.
          startTime: params.lockStartTime,
          endTime: params.lockEndTime,
        })),
      });

      const [{ nextval }] = await tx.$queryRaw<
        Array<{ nextval: bigint }>
      >`SELECT nextval('booking_order_seq')`;
      const orderId = formatOrderId(nextval);

      return tx.booking.create({
        data: {
          orderSeq: nextval,
          orderId,
          slotHoldId: slotHold.id,
          customerId: params.customerId,
          venueId: params.venueId,
          resourceId: params.resourceId,
          startTime: params.startTime,
          endTime: params.endTime,
          durationMinutes: params.durationMinutes,
          groundType: params.groundType,
          amount: params.amount,
          currency: params.currency,
          status: 'CONFIRMED',
          paymentMethod: params.paymentMethod,
        },
      });
    });
  }

  async cancelAtomic(params: CancelAtomicParams) {
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: params.bookingId, status: params.expectedBookingStatus as BookingStatus },
        data: {
          status: 'CANCELLED',
          cancellationReasonCode: 'CUSTOMER_REQUESTED',
          cancellationNote: params.reason,
          cancelledAt: new Date(),
        },
      });

      const currentSlotHold = await tx.slotHold.findUniqueOrThrow({
        where: { id: params.slotHoldId },
      });
      assertTransition('SlotHold', SLOT_HOLD_TRANSITIONS, currentSlotHold.status, 'RELEASED');
      await tx.slotHold.update({ where: { id: params.slotHoldId }, data: { status: 'RELEASED' } });
      await tx.resourceLock.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'RELEASED' },
      });
      // No-op for exclusive holds (they own zero reservation rows) and
      // the release for pooled holds — same transaction, same guarantee.
      await tx.inventoryReservation.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'RELEASED' },
      });

      if (!params.refundData) {
        return { booking: updated, refund: null };
      }

      const refund = await tx.refund.create({
        data: {
          bookingId: params.bookingId,
          originalAmount: params.refundData.originalAmount,
          originalCurrency: params.refundData.originalCurrency,
          coinAmountCredited: params.refundData.coinAmountCredited,
          status: 'PENDING',
          reason: params.reason,
          policySnapshot: params.refundData.policySnapshot,
        },
      });

      return { booking: updated, refund };
    });
  }
}
