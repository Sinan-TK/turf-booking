import type {
  Booking,
  CustomerProfile,
  Payment,
  Prisma,
  Refund,
  SlotHold,
  WalletTopup,
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
  /** Which path confirmed it: the webhook, the customer's browser, or the reconciler. */
  confirmedVia: 'WEBHOOK' | 'CLIENT' | 'RECONCILER';
}

/** A payment the gateway captured after its booking lost the slot, honoured only when the slot is still free. */
export interface HonourLatePaymentParams {
  paymentId: string;
  paymentStatus: string;
  gatewayPaymentId: string | undefined;
  rawPayload: unknown;
  bookingId: string;
  bookingStatus: string;
  slotHoldId: string;
  paidAmount: Prisma.Decimal | number | string;
  confirmedVia: 'WEBHOOK' | 'CLIENT' | 'RECONCILER';
}

export type ProcessingDueBooking = Prisma.BookingGetPayload<{
  include: { payments: true; venue: { select: { organizationId: true } } };
}>;

export type StalePendingPayment = Prisma.PaymentGetPayload<{ include: { booking: { select: { status: true } } } }>;

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
  /** `duplicate` only when this event was already PROCESSED; one that failed earlier is handed back to be run again. */
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

  // --- payments in flight, the processing window and late captures
  /** The newest unfinished (PENDING or PROCESSING) Razorpay payment of a booking, so a second click reuses it. */
  findOpenRazorpayPayment(bookingId: string): Promise<Payment | null>;
  /** Pushes a HELD hold's expiry out; false when it is no longer HELD (the sweeper got there first). */
  extendSlotHoldIfHeld(id: string, holdExpiresAt: Date): Promise<boolean>;
  /** The customer's side reported success: payment -> PROCESSING and booking -> PROCESSING with its slot kept locked until processingUntil. */
  markProcessingAtomic(params: {
    paymentId: string;
    gatewayPaymentId: string;
    bookingId: string;
    slotHoldId: string;
    processingUntil: Date;
  }): Promise<{ bookingMoved: boolean }>;
  /**
   * The customer opened the payment popup: the booking is PROCESSING and its slot stays locked until processingUntil, with no payment
   * reported yet. Safe to repeat (a second click only moves the end of the window).
   */
  markAttemptAtomic(params: { bookingId: string; slotHoldId: string; processingUntil: Date }): Promise<boolean>;
  /** Whether the customer's side has reported a payment for this booking (as opposed to only opening the popup). */
  hasReportedPayment(bookingId: string): Promise<boolean>;
  /** The popup was closed without paying: PROCESSING -> PENDING_PAYMENT again, the slot kept until holdUntil. False if it was not an attempt. */
  revertAttemptAtomic(params: { bookingId: string; slotHoldId: string; holdUntil: Date }): Promise<boolean>;
  honourLatePaymentAtomic(params: HonourLatePaymentParams): Promise<boolean>;
  /** The processing window ended with nothing captured: booking FAILED, payments EXPIRED, slot released. */
  failProcessingAtomic(params: { bookingId: string; slotHoldId: string }): Promise<boolean>;
  listProcessing(): Promise<ProcessingDueBooking[]>;
  listStalePendingPayments(olderThan: Date): Promise<StalePendingPayment[]>;
  closePayment(paymentId: string, expectedStatus: string, to: 'FAILED' | 'EXPIRED', reason: string): Promise<void>;

  // --- wallet recharges
  createWalletTopup(params: {
    customerId: string;
    amount: Prisma.Decimal | number | string;
    currency: string;
    gatewayOrderId: string;
  }): Promise<WalletTopup>;
  findWalletTopupByOrderId(gatewayOrderId: string): Promise<WalletTopup | null>;
  findWalletTopupById(id: string): Promise<WalletTopup | null>;
  markWalletTopupVerified(id: string, gatewayPaymentId: string): Promise<void>;
  closeWalletTopup(id: string, to: 'FAILED' | 'EXPIRED', reason: string): Promise<void>;
  listStalePendingTopups(olderThan: Date): Promise<WalletTopup[]>;
  markPaymentFailed(params: {
    paymentId: string;
    expectedStatus: string;
    failureReason: string;
    rawPayload: unknown;
  }): Promise<void>;
}

export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
