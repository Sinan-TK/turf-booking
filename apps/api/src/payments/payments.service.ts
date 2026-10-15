import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  assertTransition,
  BOOKING_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  SLOT_HOLD_TRANSITIONS,
} from '@venue/shared';
import { loadEnv } from '@venue/config';
import { AuditService } from '../audit/audit.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.interface';
import { PAYMENTS_REPOSITORY, type PaymentsRepository } from './payments.repository';
import { CoinsService } from '../coins/coins.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthContext } from '../auth/auth.types';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENTS_REPOSITORY) private readonly payments: PaymentsRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly coins: CoinsService,
    private readonly audit: AuditService,
    @Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * §9 step 2: creating an order also extends the hold's expiry to
   * survive the payment attempt, decoupled from the 20-minute
   * BookingSession — this is the exact mechanism the brief calls for
   * ("payment must be allowed to finish even if the browsing session
   * expired").
   */
  async createOrder(bookingId: string, actor: AuthContext) {
    const booking = await this.payments.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) {
      throw new ForbiddenException("Cannot pay for another customer's booking");
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException(`Booking is ${booking.status}, not payable`);
    }
    const alreadyPaid = await this.payments.findSuccessfulPaymentForBooking(bookingId);
    if (alreadyPaid) throw new ConflictException('Booking is already paid');

    const env = loadEnv();
    const graceExpiry = new Date(Date.now() + env.PAYMENT_GRACE_WINDOW_MINUTES * 60 * 1000);
    const slotHold = await this.payments.findSlotHoldById(booking.slotHoldId);
    if (slotHold.holdExpiresAt < graceExpiry) {
      await this.payments.extendSlotHoldExpiry(slotHold.id, slotHold.status, graceExpiry);
    }

    const amountMinorUnits = Math.round(Number(booking.amount) * 100);
    const order = await this.provider.createOrder({
      amountMinorUnits,
      currency: booking.currency,
      receipt: booking.orderId,
    });

    const payment = await this.payments.createPendingPayment({
      bookingId,
      gatewayOrderId: order.gatewayOrderId,
      amount: booking.amount,
      currency: booking.currency,
      rawResponse: order.raw,
    });

    return {
      paymentId: payment.id,
      gatewayOrderId: order.gatewayOrderId,
      amount: booking.amount,
      currency: booking.currency,
    };
  }

  /**
   * §9 step 4: fast UI path only — verifies the checkout callback's
   * signature but makes NO state change. The webhook (handleWebhook) is
   * the only thing that ever confirms a booking; a browser that lies
   * about this, or never calls it at all, cannot get a booking
   * confirmed without the webhook also firing.
   */
  verifyClientCallback(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    signature: string;
  }) {
    const valid = this.provider.verifyClientSignature(params);
    if (!valid) throw new BadRequestException('Invalid payment signature');
    return { verified: true };
  }

  async handleWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    eventIdHeader: string | undefined,
  ) {
    if (!this.provider.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const {
      eventId: derivedEventId,
      eventType,
      payload,
    } = this.provider.parseWebhookPayload(rawBody);
    const eventId = eventIdHeader ?? derivedEventId;

    // Idempotency (§9 step 5, §17): the unique (gateway, eventId)
    // constraint is the actual dedup mechanism — the repository surfaces
    // a duplicate result instead of leaking the database error (a
    // pre-check would leave a race window between check and insert).
    const recorded = await this.payments.recordWebhookEvent({
      gateway: 'RAZORPAY',
      eventId,
      eventType,
      payload,
    });
    if (recorded.duplicate) {
      this.logger.log(
        `Duplicate webhook event ${eventId} (${eventType}) — already processed, no-op`,
      );
      return { status: 'duplicate' };
    }
    const webhookEvent = recorded.event;

    try {
      if (eventType === 'payment.captured') {
        await this.handlePaymentCaptured(payload);
      } else if (eventType === 'payment.failed') {
        await this.handlePaymentFailed(payload);
      }
      await this.payments.markWebhookEvent(webhookEvent.id, 'PROCESSED');
    } catch (error) {
      await this.payments.markWebhookEvent(webhookEvent.id, 'FAILED');
      throw error;
    }

    return { status: 'ok' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handlePaymentCaptured(payload: any) {
    const entity = payload?.payload?.payment?.entity;
    const gatewayOrderId: string | undefined = entity?.order_id;
    const gatewayPaymentId: string | undefined = entity?.id;
    if (!gatewayOrderId) return;

    const payment = await this.payments.findPaymentByGatewayOrderId(gatewayOrderId);
    if (!payment) {
      this.logger.warn(`payment.captured for unknown gatewayOrderId ${gatewayOrderId}`);
      return;
    }
    if (payment.status === 'SUCCESS') return; // already processed — safe no-op

    assertTransition('Payment', PAYMENT_TRANSITIONS, payment.status, 'SUCCESS');

    const booking = await this.payments.findBookingWithOrg(payment.bookingId);
    const slotHold = await this.payments.findSlotHoldById(booking.slotHoldId);

    // §9 step 7 / §19: the webhook can legitimately arrive after the
    // hold's own expiry job already ran — and by the time it does, that
    // job has very likely *already cancelled* the booking too (it runs
    // every minute; the payment-grace-window extension in createOrder()
    // exists specifically to make this rare, not impossible). The only
    // path this method ever confirms through is the exact fast-path
    // state (HELD + PENDING_PAYMENT); anything else — expired hold,
    // already-cancelled booking, or both — is treated uniformly as "too
    // late," paid but not honored, refunded to coins. This deliberately
    // does NOT attempt to resurrect a CANCELLED booking (not a legal
    // transition, and not one worth bypassing the state machine for) even
    // in the rare case the resource happens to still be free — simpler
    // and safer than the earlier version of this method, which tried to
    // special-case that and got the state machine interaction wrong.
    const fastPathEligible = booking.status === 'PENDING_PAYMENT' && slotHold.status === 'HELD';

    if (!fastPathEligible) {
      const refund = await this.payments.recordLatePaymentAtomic({
        paymentId: payment.id,
        paymentStatus: payment.status,
        gatewayPaymentId,
        rawPayload: payload,
        bookingId: booking.id,
        bookingStatus: booking.status,
        bookingAmount: booking.amount,
        bookingCurrency: booking.currency,
        cancelBooking: booking.status === 'PENDING_PAYMENT',
      });
      // Outside the transaction above, same reasoning as
      // BookingsService.cancel: CoinsService does its own wallet-row
      // locking, PENDING is a safe intermediate state, and the
      // idempotency key rules out a double credit if this step retries.
      await this.coins.completeRefund(refund.id);
      await this.audit.record({
        actor: 'SYSTEM',
        action: 'PAYMENT_LATE_SUCCESS_NOT_HONORED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: {
          paymentId: payment.id,
          bookingStatusAtWebhook: booking.status,
          slotHoldStatusAtWebhook: slotHold.status,
        },
      });
      await this.notifications
        .notifyOrganizationOwners(booking.venue.organizationId, {
          type: 'SYSTEM',
          title: 'Payment received — booking not honored',
          message: `A payment for booking ${booking.orderId} arrived after the slot was released; it has been refunded as Coins to the customer.`,
          data: { bookingId: booking.id, orderId: booking.orderId, venueId: booking.venueId, resourceId: booking.resourceId },
        })
        .catch(() => undefined);
      return;
    }

    assertTransition('SlotHold', SLOT_HOLD_TRANSITIONS, slotHold.status, 'CONFIRMED');
    assertTransition('Booking', BOOKING_TRANSITIONS, booking.status, 'CONFIRMED');

    await this.payments.confirmPaymentAtomic({
      paymentId: payment.id,
      paymentStatus: payment.status,
      gatewayPaymentId,
      rawPayload: payload,
      bookingId: booking.id,
      bookingStatus: booking.status,
      slotHoldId: slotHold.id,
      slotHoldStatus: slotHold.status,
    });

    await this.audit.record({
      actor: 'SYSTEM',
      action: 'PAYMENT_CONFIRMED',
      entityType: 'Booking',
      entityId: booking.id,
      metadata: { paymentId: payment.id, gatewayPaymentId },
    });

    // Awaited (errors swallowed) rather than fire-and-forget, for the
    // same ordering reason as BookingsService.cancel's notification —
    // a notification failure must never undo an already-committed
    // payment confirmation, but message order still matters wherever
    // this response feeds into a chat flow.
    await this.notifyBookingConfirmed(booking.customerId, booking.orderId).catch(() => undefined);

    // One consolidated notification, not separate PAYMENT_RECEIVED +
    // BOOKING_CONFIRMED rows — this webhook is the single event behind
    // both facts in this codebase (there's no separate "payment
    // received, booking still pending" state to report).
    await this.notifications
      .notifyOrganizationOwners(booking.venue.organizationId, {
        type: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed',
        message: `Booking ${booking.orderId} confirmed — payment received.`,
        data: { bookingId: booking.id, orderId: booking.orderId, venueId: booking.venueId, resourceId: booking.resourceId },
      })
      .catch(() => undefined);
  }

  private async notifyBookingConfirmed(customerId: string, orderId: string): Promise<void> {
    const customer = await this.payments.findCustomerById(customerId);
    if (!customer) return;
    await this.messenger.bookingConfirmed(customer.whatsappNumber, orderId);
  }

  /** Platform-wide listing for the Super Admin Portal (§12). */
  async listPaymentsForAdmin(filters: { status?: string; limit?: number }) {
    return this.payments.listPaymentsForAdmin(filters);
  }

  async listRefundsForAdmin(filters: { status?: string; limit?: number }) {
    return this.payments.listRefundsForAdmin(filters);
  }

  /** Org-scoped listings for the Venue Owner Portal — view-only, per the
   * brief (§12/§14): owners can see their own payments/refunds but never
   * mutate them directly. */
  async listPaymentsForOwner(organizationId: string, filters: { status?: string; limit?: number }) {
    return this.payments.listPaymentsForOwner(organizationId, filters);
  }

  async listRefundsForOwner(organizationId: string, filters: { status?: string; limit?: number }) {
    return this.payments.listRefundsForOwner(organizationId, filters);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handlePaymentFailed(payload: any) {
    const entity = payload?.payload?.payment?.entity;
    const gatewayOrderId: string | undefined = entity?.order_id;
    if (!gatewayOrderId) return;

    const payment = await this.payments.findFailedPaymentView(gatewayOrderId);
    if (!payment || payment.status !== 'PENDING') return; // already resolved — safe no-op

    assertTransition('Payment', PAYMENT_TRANSITIONS, payment.status, 'FAILED');
    await this.payments.markPaymentFailed({
      paymentId: payment.id,
      expectedStatus: payment.status,
      failureReason: entity?.error_description ?? 'Payment failed',
      rawPayload: payload,
    });
    // Booking stays PENDING_PAYMENT — the hold-expiry job (ExpiryService)
    // cancels it once holdExpiresAt passes, releasing the resource. No
    // need to duplicate that logic here.

    await this.notifications
      .notifyOrganizationOwners(payment.booking.venue.organizationId, {
        type: 'PAYMENT_FAILED',
        title: 'Payment failed',
        message: `Payment for booking ${payment.booking.orderId} failed.`,
        data: {
          bookingId: payment.booking.id,
          orderId: payment.booking.orderId,
          venueId: payment.booking.venueId,
          resourceId: payment.booking.resourceId,
        },
      })
      .catch(() => undefined);
  }
}
