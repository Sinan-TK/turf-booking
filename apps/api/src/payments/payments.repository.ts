import type {
  Booking,
  CustomerProfile,
  Payment,
  Prisma,
  Refund,
  SlotHold,
  WebhookEvent,
} from '@venue/database';
import type { DateRange } from '../common/list-filters';

export interface AdminPaymentFilters {
  /** Restrict to one owner organization's venues (the owner portal's own list). */
  organizationId?: string;
  status?: string;
  provider?: string;
  /** Matches order id, gateway order/payment id, customer name/number. */
  search?: string;
  /** Window on when the payment was created. */
  range?: DateRange;
}

export interface AdminRefundFilters {
  organizationId?: string;
  status?: string;
  /** Matches order id, reason, customer name/number. */
  search?: string;
  range?: DateRange;
}

/** Booking with the venue organization needed for owner notifications. */
export type BookingWithOrg = Booking & {
  venue: { organizationId: string };
};

/** Payment with booking + venue org for the payment.failed path. */
export type FailedPaymentView = Prisma.PaymentGetPayload<{
  include: { booking: { include: { venue: { select: { organizationId: true } } } } };
}>;

export type PaymentListItem = Prisma.PaymentGetPayload<{
  include: {
    booking: { select: { id: true; orderId: true; venueId: true; customerId: true; amount: true } };
  };
}>;

export type RefundListItem = Prisma.RefundGetPayload<{
  include: {
    booking: { select: { id: true; orderId: true; venueId: true; customerId: true } };
  };
}>;

export interface LatePaymentAtomicParams {
  paymentId: string;
  paymentStatus: string;
  gatewayPaymentId: string | undefined;
  rawPayload: unknown;
  bookingId: string;
  bookingStatus: string;
  bookingAmount: Prisma.Decimal | number | string;
  bookingCurrency: string;
  /** False when the booking already left PENDING_PAYMENT (already cancelled). */
  cancelBooking: boolean;
}

export interface ConfirmPaymentAtomicParams {
  paymentId: string;
  paymentStatus: string;
  gatewayPaymentId: string | undefined;
  rawPayload: unknown;
  bookingId: string;
  bookingStatus: string;
  slotHoldId: string;
  slotHoldStatus: string;
  /** What this payment collected: the booking is paid up to this much. */
  paidAmount: Prisma.Decimal | number | string;
}

/**
 * Clean-Architecture port: PaymentsService (use-case) depends on this
 * interface, never on Prisma directly. PrismaPaymentsRepository is the
 * only file in this module allowed to touch PrismaService.
 *
 * Webhook dedup is expressed as a domain result ({ duplicate: true })
 * rather than leaking Prisma's P2002 error to the service — the unique
 * (gateway, eventId) constraint remains the actual mechanism, the
 * service just never sees the database error.
 */
export interface PaymentsRepository {
  findBookingById(id: string): Promise<Booking | null>;
  findSuccessfulPaymentForBooking(bookingId: string): Promise<Payment | null>;
  findSlotHoldById(id: string): Promise<SlotHold>;
  extendSlotHoldExpiry(id: string, expectedStatus: string, holdExpiresAt: Date): Promise<void>;
  createPendingPayment(params: {
    bookingId: string;
    gatewayOrderId: string;
    amount: Prisma.Decimal | number | string;
    currency: string;
    rawResponse: unknown;
  }): Promise<Payment>;
  recordWebhookEvent(params: {
    gateway: string;
    eventId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ duplicate: true } | { duplicate: false; event: WebhookEvent }>;
  markWebhookEvent(id: string, status: 'PROCESSED' | 'FAILED'): Promise<void>;
  findPaymentByGatewayOrderId(gatewayOrderId: string): Promise<Payment | null>;
  findBookingWithOrg(id: string): Promise<BookingWithOrg>;
  recordLatePaymentAtomic(params: LatePaymentAtomicParams): Promise<Refund>;
  confirmPaymentAtomic(params: ConfirmPaymentAtomicParams): Promise<void>;
  findCustomerById(id: string): Promise<CustomerProfile | null>;
  listPaymentsForAdmin(filters: AdminPaymentFilters & { limit?: number; offset?: number }): Promise<PaymentListItem[]>;
  countPaymentsForAdmin(filters: AdminPaymentFilters): Promise<number>;
  listRefundsForAdmin(filters: AdminRefundFilters & { limit?: number; offset?: number }): Promise<RefundListItem[]>;
  countRefundsForAdmin(filters: AdminRefundFilters): Promise<number>;
  findFailedPaymentView(gatewayOrderId: string): Promise<FailedPaymentView | null>;
  markPaymentFailed(params: {
    paymentId: string;
    expectedStatus: string;
    failureReason: string;
    rawPayload: unknown;
  }): Promise<void>;
}

export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
