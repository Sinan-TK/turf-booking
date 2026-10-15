import { Injectable } from '@nestjs/common';
import { Prisma } from '@venue/database';
import type { BookingStatus, PaymentStatus, RefundStatus, SlotHoldStatus, WebhookGateway } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ConfirmPaymentAtomicParams,
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
        return { duplicate: true as const };
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
          rawResponse: params.rawPayload as Prisma.InputJsonValue,
        },
      });
      await tx.booking.update({
        where: { id: params.bookingId, status: params.bookingStatus as BookingStatus },
        data: { status: 'CONFIRMED', paymentMethod: 'MONEY' },
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

  listPaymentsForAdmin(filters: { status?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.payment.findMany({
      where: { status: filters.status ? (filters.status as PaymentStatus) : undefined },
      include: {
        booking: {
          select: { id: true, orderId: true, venueId: true, customerId: true, amount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listRefundsForAdmin(filters: { status?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.refund.findMany({
      where: { status: filters.status ? (filters.status as RefundStatus) : undefined },
      include: {
        booking: { select: { id: true, orderId: true, venueId: true, customerId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listPaymentsForOwner(organizationId: string, filters: { status?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.payment.findMany({
      where: {
        status: filters.status ? (filters.status as PaymentStatus) : undefined,
        booking: { venue: { organizationId } },
      },
      include: {
        booking: {
          select: { id: true, orderId: true, venueId: true, customerId: true, amount: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  listRefundsForOwner(organizationId: string, filters: { status?: string; limit?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    return this.prisma.client.refund.findMany({
      where: {
        status: filters.status ? (filters.status as RefundStatus) : undefined,
        booking: { venue: { organizationId } },
      },
      include: {
        booking: { select: { id: true, orderId: true, venueId: true, customerId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
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
