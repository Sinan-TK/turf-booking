import { Injectable } from '@nestjs/common';
import { Prisma } from '@venue/database';
import type { BookingStatus, PaymentProviderType, PaymentStatus, RefundStatus, SlotHoldStatus, WebhookGateway } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { contains, dateWhere } from '../common/list-filters';
import type {
  AdminPaymentFilters,
  AdminRefundFilters,
  ConfirmPaymentAtomicParams,
  HonourLatePaymentParams,
  LatePaymentAtomicParams,
  PaymentsRepository,
} from './payments.repository';

/**
 * Prisma-backed PaymentsRepository. The ONLY file in the payments module
 * allowed to touch PrismaService. Query shapes are moved verbatim from
 * PaymentsService — including the two $transaction blocks in the
 * payment.captured path, which must stay atomic.
 *
 * Webhook dedup: the unique (gateway, eventId) constraint is the actual
 * mechanism (not a pre-check, which would leave a race window); P2002 is
 * caught here and surfaced as { duplicate: true } so the service never
 * imports a Prisma error class.
 */
@Injectable()
export class PrismaPaymentsRepository implements PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBookingById(id: string) {
    return this.prisma.client.booking.findUnique({ where: { id } });
  }

  findSuccessfulPaymentForBooking(bookingId: string) {
    return this.prisma.client.payment.findFirst({
      where: { bookingId, status: 'SUCCESS' },
    });
  }

  findSlotHoldById(id: string) {
    return this.prisma.client.slotHold.findUniqueOrThrow({ where: { id } });
  }

  async extendSlotHoldExpiry(id: string, expectedStatus: string, holdExpiresAt: Date) {
    await this.prisma.client.slotHold.update({
      where: { id, status: expectedStatus as SlotHoldStatus },
      data: { holdExpiresAt },
    });
  }

  createPendingPayment(params: {
    bookingId: string;
    gatewayOrderId: string;
    amount: Prisma.Decimal | number | string;
    currency: string;
    rawResponse: unknown;
  }) {
    return this.prisma.client.payment.create({
      data: {
        bookingId: params.bookingId,
        provider: 'RAZORPAY',
        gatewayOrderId: params.gatewayOrderId,
        amount: params.amount,
        currency: params.currency,
        status: 'PENDING',
        rawResponse: params.rawResponse as Prisma.InputJsonValue,
      },
    });
  }

  async recordWebhookEvent(params: {
    gateway: string;
    eventId: string;
    eventType: string;
    payload: unknown;
  }) {
    try {
      const event = await this.prisma.client.webhookEvent.create({
        data: {
          gateway: params.gateway as WebhookGateway,
          eventId: params.eventId,
          eventType: params.eventType,
          payload: params.payload as Prisma.InputJsonValue,
          signatureValid: true,
          status: 'RECEIVED',
        },
      });
      return { duplicate: false as const, event };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Seen before. Only an event that was fully handled is a duplicate: one that FAILED (or never finished) is run again when
        // the gateway re-sends it, otherwise a payment lost to a one-off error could never be recovered.
        const existing = await this.prisma.client.webhookEvent.findUnique({
          where: { gateway_eventId: { gateway: params.gateway as WebhookGateway, eventId: params.eventId } },
        });
        if (!existing || existing.status === 'PROCESSED' || existing.status === 'IGNORED') return { duplicate: true as const };
        const event = await this.prisma.client.webhookEvent.update({ where: { id: existing.id }, data: { status: 'RECEIVED' } });
        return { duplicate: false as const, event };
      }
      throw error;
    }
  }

  async markWebhookEvent(id: string, status: 'PROCESSED' | 'FAILED') {
    await this.prisma.client.webhookEvent.update({
      where: { id },
      data: status === 'PROCESSED' ? { status, processedAt: new Date() } : { status },
    });
  }

  findPaymentByGatewayOrderId(gatewayOrderId: string) {
    return this.prisma.client.payment.findUnique({ where: { gatewayOrderId } });
  }

  findBookingWithOrg(id: string) {
    return this.prisma.client.booking.findUniqueOrThrow({
      where: { id },
      include: { venue: { select: { organizationId: true } } },
    });
  }

  async recordLatePaymentAtomic(params: LatePaymentAtomicParams) {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: params.paymentId, status: params.paymentStatus as PaymentStatus },
        data: {
          status: 'SUCCESS',
          gatewayPaymentId: params.gatewayPaymentId,
          rawResponse: params.rawPayload as Prisma.InputJsonValue,
        },
      });
      if (params.cancelBooking) {
        await tx.booking.update({
          where: { id: params.bookingId, status: params.bookingStatus as BookingStatus },
          data: {
            status: 'CANCELLED',
            cancellationReasonCode: 'RESOURCE_REALLOCATED',
            cancelledAt: new Date(),
          },
        });
      }
      return tx.refund.create({
        data: {
          bookingId: params.bookingId,
          paymentId: params.paymentId,
          originalAmount: params.bookingAmount,
          originalCurrency: params.bookingCurrency,
          coinAmountCredited: params.bookingAmount,
          status: 'PENDING',
          reason: 'Payment confirmed too late to honor the booking (hold expired)',
          policySnapshot: { fullRefund: true, reason: 'RESOURCE_REALLOCATED' },
        },
      });
    });
  }

  async confirmPaymentAtomic(params: ConfirmPaymentAtomicParams) {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: params.paymentId, status: params.paymentStatus as PaymentStatus },
        data: {
          status: 'SUCCESS',
          gatewayPaymentId: params.gatewayPaymentId,
          confirmedVia: params.confirmedVia,
          rawResponse: params.rawPayload as Prisma.InputJsonValue,
        },
      });
      await tx.booking.update({
        where: { id: params.bookingId, status: params.bookingStatus as BookingStatus },
        data: {
          status: 'CONFIRMED',
          paymentMethod: 'MONEY',
          paidAmount: params.paidAmount,
          moneyPaid: params.paidAmount,
          coinsPaid: 0,
          processingUntil: null,
        },
      });
      await tx.slotHold.update({
        where: { id: params.slotHoldId, status: params.slotHoldStatus as SlotHoldStatus },
        data: { status: 'CONFIRMED' },
      });
      await tx.resourceLock.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'CONFIRMED' },
      });
      // No-op for exclusive holds; confirms pooled reservations. Kept in
      // sync with cancelAtomic/expiry/redeem paths — every HELD→CONFIRMED
      // transition must move both inventory tables or pooled units leak.
      await tx.inventoryReservation.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'CONFIRMED' },
      });
    });
  }

  findCustomerById(id: string) {
    return this.prisma.client.customerProfile.findUnique({ where: { id } });
  }

  private adminPaymentWhere(filters: AdminPaymentFilters) {
    const q = filters.search;
    return {
      booking: filters.organizationId ? { venue: { organizationId: filters.organizationId } } : undefined,
      status: filters.status ? (filters.status as PaymentStatus) : undefined,
      provider: filters.provider ? (filters.provider as PaymentProviderType) : undefined,
      createdAt: dateWhere(filters.range),
      OR: q
        ? [
            { gatewayOrderId: contains(q) },
            { gatewayPaymentId: contains(q) },
            { booking: { orderId: contains(q) } },
            { booking: { customer: { whatsappNumber: contains(q) } } },
            { booking: { customer: { name: contains(q) } } },
            { booking: { customer: { email: contains(q) } } },
          ]
        : undefined,
    };
  }

  private adminRefundWhere(filters: AdminRefundFilters) {
    const q = filters.search;
    return {
      booking: filters.organizationId ? { venue: { organizationId: filters.organizationId } } : undefined,
      status: filters.status ? (filters.status as RefundStatus) : undefined,
      createdAt: dateWhere(filters.range),
      OR: q
        ? [
            { reason: contains(q) },
            { booking: { orderId: contains(q) } },
            { booking: { customer: { whatsappNumber: contains(q) } } },
            { booking: { customer: { name: contains(q) } } },
            { booking: { customer: { email: contains(q) } } },
          ]
        : undefined,
    };
  }

  countPaymentsForAdmin(filters: AdminPaymentFilters) {
    return this.prisma.client.payment.count({ where: this.adminPaymentWhere(filters) });
  }

  countRefundsForAdmin(filters: AdminRefundFilters) {
    return this.prisma.client.refund.count({ where: this.adminRefundWhere(filters) });
  }

  listPaymentsForAdmin(filters: AdminPaymentFilters & { limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.payment.findMany({
      where: this.adminPaymentWhere(filters),
      include: {
        booking: {
          select: { id: true, orderId: true, venueId: true, customerId: true, amount: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: filters.offset ?? 0,
    });
  }

  listRefundsForAdmin(filters: AdminRefundFilters & { limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.refund.findMany({
      where: this.adminRefundWhere(filters),
      include: {
        booking: { select: { id: true, orderId: true, venueId: true, customerId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: filters.offset ?? 0,
    });
  }

  findOpenRazorpayPayment(bookingId: string) {
    return this.prisma.client.payment.findFirst({
      where: { bookingId, provider: 'RAZORPAY', status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async extendSlotHoldIfHeld(id: string, holdExpiresAt: Date) {
    const result = await this.prisma.client.slotHold.updateMany({
      where: { id, status: 'HELD', holdExpiresAt: { lt: holdExpiresAt } },
      data: { holdExpiresAt },
    });
    // 0 rows is also "already extended further", so look again before saying the hold is gone.
    if (result.count > 0) return true;
    const hold = await this.prisma.client.slotHold.findUnique({ where: { id }, select: { status: true } });
    return hold?.status === 'HELD';
  }

  async markProcessingAtomic(params: {
    paymentId: string;
    gatewayPaymentId: string;
    bookingId: string;
    slotHoldId: string;
    processingUntil: Date;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: params.paymentId, status: 'PENDING' },
        data: { status: 'PROCESSING', gatewayPaymentId: params.gatewayPaymentId, clientVerifiedAt: new Date() },
      });
      const moved = await tx.booking.updateMany({
        where: { id: params.bookingId, status: 'PENDING_PAYMENT' },
        data: { status: 'PROCESSING', processingUntil: params.processingUntil },
      });
      if (moved.count > 0) {
        // The slot stays locked until the processing window ends (a minute of slack so the sweepers never race the deadline).
        await tx.slotHold.updateMany({
          where: { id: params.slotHoldId, status: 'HELD' },
          data: { holdExpiresAt: new Date(params.processingUntil.getTime() + 60_000) },
        });
      }
      return { bookingMoved: moved.count > 0 };
    });
  }

  async honourLatePaymentAtomic(params: HonourLatePaymentParams) {
    // Only a single unit can be put back (its lock row is simply switched on again: the database refuses it if anyone booked the slot
    // meanwhile). A pooled item's units are counted rather than locked, so those late payments are refunded instead.
    const pooled = await this.prisma.client.inventoryReservation.count({ where: { slotHoldId: params.slotHoldId } });
    if (pooled > 0) return false;
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const booking = await tx.booking.updateMany({
          where: {
            id: params.bookingId,
            OR: [{ status: 'FAILED' }, { status: 'CANCELLED', cancellationReasonCode: 'HOLD_EXPIRED' }],
          },
          data: {
            status: 'CONFIRMED',
            cancellationReasonCode: null,
            cancelledAt: null,
            processingUntil: null,
            paymentMethod: 'MONEY',
            paidAmount: params.paidAmount,
            moneyPaid: params.paidAmount,
            coinsPaid: 0,
          },
        });
        if (booking.count === 0) throw new HonourRefused();
        const hold = await tx.slotHold.updateMany({ where: { id: params.slotHoldId, status: 'EXPIRED' }, data: { status: 'CONFIRMED' } });
        if (hold.count === 0) throw new HonourRefused();
        // The exclusion constraint on overlapping active locks is the "is the slot still free?" check.
        await tx.resourceLock.updateMany({ where: { slotHoldId: params.slotHoldId }, data: { status: 'CONFIRMED' } });
        await tx.payment.update({
          where: { id: params.paymentId, status: params.paymentStatus as PaymentStatus },
          data: {
            status: 'SUCCESS',
            gatewayPaymentId: params.gatewayPaymentId,
            confirmedVia: params.confirmedVia,
            rawResponse: params.rawPayload as Prisma.InputJsonValue,
          },
        });
      });
      return true;
    } catch (error) {
      if (error instanceof HonourRefused || isExclusionViolation(error)) return false;
      throw error;
    }
  }

  async failProcessingAtomic(params: { bookingId: string; slotHoldId: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const failed = await tx.booking.updateMany({
        where: { id: params.bookingId, status: 'PROCESSING' },
        data: { status: 'FAILED', cancellationReasonCode: 'PAYMENT_NOT_CONFIRMED', cancelledAt: new Date(), processingUntil: null },
      });
      if (failed.count === 0) return false; // it was confirmed (or cancelled) in the meantime
      await tx.payment.updateMany({
        where: { bookingId: params.bookingId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'EXPIRED', failureReason: 'The gateway did not confirm the payment in time' },
      });
      await tx.slotHold.updateMany({ where: { id: params.slotHoldId, status: 'HELD' }, data: { status: 'EXPIRED' } });
      await tx.resourceLock.updateMany({ where: { slotHoldId: params.slotHoldId, status: 'HELD' }, data: { status: 'EXPIRED' } });
      await tx.inventoryReservation.updateMany({ where: { slotHoldId: params.slotHoldId, status: 'HELD' }, data: { status: 'EXPIRED' } });
      return true;
    });
  }

  listProcessing() {
    return this.prisma.client.booking.findMany({
      where: { status: 'PROCESSING' },
      include: { payments: true, venue: { select: { organizationId: true } } },
    });
  }

  listStalePendingPayments(olderThan: Date) {
    return this.prisma.client.payment.findMany({
      where: { provider: 'RAZORPAY', status: { in: ['PENDING', 'PROCESSING'] }, createdAt: { lt: olderThan }, gatewayOrderId: { not: null } },
      include: { booking: { select: { status: true } } },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
  }

  async closePayment(paymentId: string, expectedStatus: string, to: 'FAILED' | 'EXPIRED', reason: string) {
    await this.prisma.client.payment.updateMany({
      where: { id: paymentId, status: expectedStatus as PaymentStatus },
      data: { status: to, failureReason: reason },
    });
  }

  createWalletTopup(params: { customerId: string; amount: Prisma.Decimal | number | string; currency: string; gatewayOrderId: string }) {
    return this.prisma.client.walletTopup.create({ data: params });
  }

  findWalletTopupByOrderId(gatewayOrderId: string) {
    return this.prisma.client.walletTopup.findUnique({ where: { gatewayOrderId } });
  }

  findWalletTopupById(id: string) {
    return this.prisma.client.walletTopup.findUnique({ where: { id } });
  }

  async markWalletTopupVerified(id: string, gatewayPaymentId: string) {
    await this.prisma.client.walletTopup.updateMany({
      where: { id, status: 'PENDING' },
      data: { gatewayPaymentId, clientVerifiedAt: new Date() },
    });
  }

  async closeWalletTopup(id: string, to: 'FAILED' | 'EXPIRED', reason: string) {
    await this.prisma.client.walletTopup.updateMany({ where: { id, status: 'PENDING' }, data: { status: to, failureReason: reason } });
  }

  listStalePendingTopups(olderThan: Date) {
    return this.prisma.client.walletTopup.findMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });
  }

  findFailedPaymentView(gatewayOrderId: string) {
    return this.prisma.client.payment.findUnique({
      where: { gatewayOrderId },
      include: { booking: { include: { venue: { select: { organizationId: true } } } } },
    });
  }

  async markPaymentFailed(params: {
    paymentId: string;
    expectedStatus: string;
    failureReason: string;
    rawPayload: unknown;
  }) {
    await this.prisma.client.payment.update({
      where: { id: params.paymentId, status: params.expectedStatus as PaymentStatus },
      data: {
        status: 'FAILED',
        failureReason: params.failureReason,
        rawResponse: params.rawPayload as Prisma.InputJsonValue,
      },
    });
  }
}

/** Thrown inside the late-payment transaction to roll it back when the booking or hold is not in a state that can be honoured. */
class HonourRefused extends Error {}

/** Postgres refused to switch a slot back on because another booking holds it now (the no_overlapping_resource_locks constraint). */
function isExclusionViolation(error: unknown): boolean {
  const text = `${(error as { message?: string })?.message ?? ''} ${JSON.stringify((error as { meta?: unknown })?.meta ?? {})}`;
  return /no_overlapping_resource_locks|23P01|exclusion/i.test(text);
}
