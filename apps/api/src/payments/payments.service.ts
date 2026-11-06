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
import { PAYMENT_PROVIDER, type GatewayPayment, type PaymentProvider } from './payment-provider.interface';
import {
  PAYMENTS_REPOSITORY,
  type AdminPaymentFilters,
  type AdminRefundFilters,
  type PaymentsRepository,
} from './payments.repository';
import { CoinsService } from '../coins/coins.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthContext } from '../auth/auth.types';

/** Which path confirmed a payment: the gateway's webhook (normal), the customer's own browser, or the reconciler (both mean the webhook did not get there first). */
export type SettleVia = 'WEBHOOK' | 'CLIENT' | 'RECONCILER';

/** What a captured payment turned into. */
export type SettleOutcome = 'confirmed' | 'honoured' | 'refunded' | 'topup' | 'already' | 'unknown';

const toMinor = (amount: { toString(): string } | number | string) => Math.round(Number(amount.toString()) * 100);

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
   * §9 step 2: starting a payment keeps the slot held for the attempt (decoupled from the BookingSession). The slot must still be
   * held and unexpired; a second click reuses the open order instead of making another; and the extra time is capped so a hold
   * cannot be kept alive for ever by repeated attempts.
   */
  async createOrder(bookingId: string, actor: AuthContext) {
    const booking = await this.payments.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) {
      throw new ForbiddenException("Cannot pay for another customer's booking");
    }
    // PROCESSING is also what a booking shows while the payment popup is open: that is only an attempt, so the customer can open it again.
    if (booking.status === 'PROCESSING' && (await this.payments.hasReportedPayment(bookingId))) {
      throw new ConflictException('Your payment is already being confirmed.');
    }
    if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'PROCESSING') {
      throw new BadRequestException(`Booking is ${booking.status}, not payable`);
    }
    const alreadyPaid = await this.payments.findSuccessfulPaymentForBooking(bookingId);
    if (alreadyPaid) throw new ConflictException('Booking is already paid');

    const slotHold = await this.payments.findSlotHoldById(booking.slotHoldId);
    if (slotHold.status !== 'HELD' || slotHold.holdExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException('This slot is no longer held. Please choose a time again.');
    }

    // Only the booking price (the advance) is charged online; the rest of the full price is paid at the venue.
    const charge = booking.advanceAmount.gt(0) ? booking.advanceAmount : booking.amount;
    const env = loadEnv();
    const extendedUntil = new Date(
      Math.min(Date.now() + env.PAYMENT_GRACE_WINDOW_MINUTES * 60_000, booking.createdAt.getTime() + env.PAYMENT_MAX_HOLD_MINUTES * 60_000),
    );

    // A second click (or a second tab) gets the order that is already open.
    const open = await this.payments.findOpenRazorpayPayment(bookingId);
    if (open?.gatewayOrderId && open.status === 'PENDING' && toMinor(open.amount) === toMinor(charge)) {
      if (!(await this.payments.extendSlotHoldIfHeld(slotHold.id, extendedUntil))) {
        throw new ConflictException('This slot is no longer held. Please choose a time again.');
      }
      const processingUntil = await this.startAttempt(booking.id, slotHold.id, booking.createdAt);
      return { paymentId: open.id, gatewayOrderId: open.gatewayOrderId, amount: charge, currency: booking.currency, reused: true, processingUntil };
    }
    if (open && open.status === 'PENDING') await this.payments.closePayment(open.id, 'PENDING', 'EXPIRED', 'Replaced by a new order');

    const order = await this.provider.createOrder({
      amountMinorUnits: toMinor(charge),
      currency: booking.currency,
      receipt: booking.orderId,
    });
    // Only now (the provider answered) is the hold extended, and only if the sweeper has not already taken it.
    if (!(await this.payments.extendSlotHoldIfHeld(slotHold.id, extendedUntil))) {
      throw new ConflictException('This slot is no longer held. Please choose a time again.');
    }

    const payment = await this.payments.createPendingPayment({
      bookingId,
      gatewayOrderId: order.gatewayOrderId,
      amount: charge,
      currency: booking.currency,
      rawResponse: order.raw,
    });

    const processingUntil = await this.startAttempt(booking.id, slotHold.id, booking.createdAt);
    return {
      paymentId: payment.id,
      gatewayOrderId: order.gatewayOrderId,
      amount: charge,
      currency: booking.currency,
      reused: false,
      processingUntil,
    };
  }

  /** The payment popup is opening: the booking shows PROCESSING and its slot is locked for the processing window (default 5 minutes). */
  private async startAttempt(bookingId: string, slotHoldId: string, bookingCreatedAt: Date): Promise<Date> {
    const env = loadEnv();
    // Never past the longest a booking may be held, however often the popup is opened.
    const processingUntil = new Date(Math.min(Date.now() + env.PAYMENT_PROCESSING_MINUTES * 60_000, bookingCreatedAt.getTime() + env.PAYMENT_MAX_HOLD_MINUTES * 60_000));
    if (processingUntil.getTime() <= Date.now() || !(await this.payments.markAttemptAtomic({ bookingId, slotHoldId, processingUntil }))) {
      throw new ConflictException('This slot is no longer held. Please choose a time again.');
    }
    return processingUntil;
  }

  /**
   * The customer closed the payment popup without paying: the booking goes back to PENDING_PAYMENT with its slot still held, so they
   * can pick another way to pay. Nothing changes once a payment has been reported (that one is waiting for the bank).
   */
  async cancelAttempt(bookingId: string, actor: AuthContext): Promise<{ status: string }> {
    const booking = await this.payments.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) throw new ForbiddenException("Cannot change another customer's booking");
    if (booking.status === 'PROCESSING') {
      const env = loadEnv();
      const holdUntil = new Date(
        Math.min(Date.now() + env.PAYMENT_GRACE_WINDOW_MINUTES * 60_000, booking.createdAt.getTime() + env.PAYMENT_MAX_HOLD_MINUTES * 60_000),
      );
      await this.payments.revertAttemptAtomic({ bookingId, slotHoldId: booking.slotHoldId, holdUntil });
    }
    const after = await this.payments.findBookingById(bookingId);
    return { status: after?.status ?? booking.status };
  }

  /**
   * The customer's browser says the payment went through (§9 step 4). This no longer depends on the webhook: after the signature and
   * ownership checks the booking moves to PROCESSING (the slot stays locked for PAYMENT_PROCESSING_MINUTES), and the gateway is asked
   * directly whether the payment was captured. Captured -> confirmed right away; otherwise it stays PROCESSING until the webhook or
   * the reconciler settles it, or the window ends.
   */
  async verifyClientCallback(
    params: { gatewayOrderId: string; gatewayPaymentId: string; signature: string },
    actor: AuthContext,
  ): Promise<{ status: 'CONFIRMED' | 'PROCESSING' | 'CREDITED' | 'LATE' | 'FAILED'; bookingId?: string }> {
    const valid = this.provider.verifyClientSignature(params);
    if (!valid) throw new BadRequestException('Invalid payment signature');

    const topup = await this.payments.findWalletTopupByOrderId(params.gatewayOrderId);
    if (topup) {
      if (topup.customerId !== actor.id) throw new ForbiddenException('Not your top-up');
      if (topup.status === 'SUCCESS') return { status: 'CREDITED' };
      await this.payments.markWalletTopupVerified(topup.id, params.gatewayPaymentId);
      await this.settleFromGateway(params.gatewayOrderId, params.gatewayPaymentId, 'CLIENT');
      const after = await this.payments.findWalletTopupById(topup.id);
      return { status: after?.status === 'SUCCESS' ? 'CREDITED' : 'PROCESSING' };
    }

    const payment = await this.payments.findPaymentByGatewayOrderId(params.gatewayOrderId);
    if (!payment) throw new NotFoundException('Payment not found');
    const booking = await this.payments.findBookingWithOrg(payment.bookingId);
    if (booking.customerId !== actor.id) throw new ForbiddenException("Cannot confirm another customer's payment");
    if (payment.status === 'SUCCESS') return { status: 'CONFIRMED', bookingId: booking.id };

    if (booking.status === 'PENDING_PAYMENT' || booking.status === 'PROCESSING') {
      const slotHold = await this.payments.findSlotHoldById(booking.slotHoldId);
      if (slotHold.status === 'HELD') {
        const processingUntil = new Date(Date.now() + loadEnv().PAYMENT_PROCESSING_MINUTES * 60_000);
        await this.payments.markProcessingAtomic({
          paymentId: payment.id,
          gatewayPaymentId: params.gatewayPaymentId,
          bookingId: booking.id,
          slotHoldId: slotHold.id,
          processingUntil,
        });
        await this.audit.record({
          actor: 'SYSTEM',
          action: 'PAYMENT_PROCESSING',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: { paymentId: payment.id, processingUntil: processingUntil.toISOString() },
        });
      }
    }

    await this.settleFromGateway(params.gatewayOrderId, params.gatewayPaymentId, 'CLIENT');
    const after = await this.payments.findBookingById(booking.id);
    const status = after?.status;
    if (status === 'CONFIRMED') return { status: 'CONFIRMED', bookingId: booking.id };
    if (status === 'PROCESSING') return { status: 'PROCESSING', bookingId: booking.id };
    if (status === 'FAILED') return { status: 'FAILED', bookingId: booking.id };
    return { status: 'LATE', bookingId: booking.id };
  }

  /** Asks the gateway about a payment (and captures it when it is only authorized); if it is captured, settles it. */
  private async settleFromGateway(gatewayOrderId: string, gatewayPaymentId: string | undefined, via: SettleVia): Promise<SettleOutcome | null> {
    let found: GatewayPayment | null = null;
    try {
      if (gatewayPaymentId) found = await this.provider.fetchPayment(gatewayPaymentId);
      if (!found || found.orderId !== gatewayOrderId) {
        const all = await this.provider.fetchOrderPayments(gatewayOrderId);
        found = all.find((p) => p.status === 'captured') ?? all.find((p) => p.status === 'authorized') ?? null;
      }
      if (found?.status === 'authorized') found = await this.provider.capturePayment(found.id, found.amountMinorUnits, found.currency);
    } catch (error) {
      this.logger.warn(`Could not ask the gateway about order ${gatewayOrderId}: ${(error as Error).message}`);
      return null;
    }
    if (!found || found.status !== 'captured' || found.orderId !== gatewayOrderId) return null;
    return this.settleCapture({
      gatewayOrderId,
      gatewayPaymentId: found.id,
      amountMinorUnits: found.amountMinorUnits,
      currency: found.currency,
      rawPayload: found,
      via,
    });
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

    // Idempotency (§9 step 5, §17): the unique (gateway, eventId) constraint is the actual dedup mechanism. Only an event that was
    // fully handled counts as a duplicate; one that failed before is run again when the gateway re-sends it.
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entity = (payload as any)?.payload?.payment?.entity;
        if (entity?.order_id) {
          await this.settleCapture({
            gatewayOrderId: entity.order_id,
            gatewayPaymentId: entity.id,
            amountMinorUnits: typeof entity.amount === 'number' ? entity.amount : undefined,
            currency: entity.currency,
            rawPayload: payload,
            via: 'WEBHOOK',
          });
        }
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

  /**
   * One payment the gateway has captured, whichever path noticed it (webhook, the customer's browser, the reconciler). Safe to run
   * any number of times: it confirms the booking, or credits the top-up, exactly once.
   */
  async settleCapture(params: {
    gatewayOrderId: string;
    gatewayPaymentId: string | undefined;
    amountMinorUnits?: number;
    currency?: string;
    rawPayload: unknown;
    via: SettleVia;
  }): Promise<SettleOutcome> {
    const topup = await this.payments.findWalletTopupByOrderId(params.gatewayOrderId);
    if (topup) return this.settleTopup(topup, params);

    const payment = await this.payments.findPaymentByGatewayOrderId(params.gatewayOrderId);
    if (!payment) {
      this.logger.warn(`payment.captured for unknown gatewayOrderId ${params.gatewayOrderId}`);
      return 'unknown';
    }
    if (payment.status === 'SUCCESS') return 'already'; // already processed — safe no-op

    // A captured amount that differs from what was asked for is never trusted to confirm anything: it is refunded as Coins.
    const mismatch =
      (params.amountMinorUnits !== undefined && params.amountMinorUnits !== toMinor(payment.amount)) ||
      (params.currency !== undefined && params.currency.toUpperCase() !== payment.currency.toUpperCase());
    const refundAmount = mismatch && params.amountMinorUnits !== undefined ? params.amountMinorUnits / 100 : payment.amount;

    assertTransition('Payment', PAYMENT_TRANSITIONS, payment.status, 'SUCCESS');

    // Two tries: if the expiry sweeper takes the slot between the read and the write, the second try sees the booking as lost
    // and settles it as a late payment, instead of failing and leaving captured money with no booking and no refund.
    for (let attempt = 0; attempt < 2; attempt++) {
      const fresh = await this.payments.findPaymentByGatewayOrderId(params.gatewayOrderId);
      if (!fresh || fresh.status === 'SUCCESS') return 'already';
      const booking = await this.payments.findBookingWithOrg(fresh.bookingId);
      const slotHold = await this.payments.findSlotHoldById(booking.slotHoldId);
      const open = (booking.status === 'PENDING_PAYMENT' || booking.status === 'PROCESSING') && slotHold.status === 'HELD';

      if (open && !mismatch) {
        assertTransition('SlotHold', SLOT_HOLD_TRANSITIONS, slotHold.status, 'CONFIRMED');
        assertTransition('Booking', BOOKING_TRANSITIONS, booking.status, 'CONFIRMED');
        try {
          await this.payments.confirmPaymentAtomic({
            paymentId: fresh.id,
            paymentStatus: fresh.status,
            gatewayPaymentId: params.gatewayPaymentId,
            rawPayload: params.rawPayload,
            bookingId: booking.id,
            bookingStatus: booking.status,
            slotHoldId: slotHold.id,
            slotHoldStatus: slotHold.status,
            paidAmount: fresh.amount,
            confirmedVia: params.via,
          });
        } catch (error) {
          if (attempt === 0) continue; // somebody else changed it between the read and the write: look again
          throw error;
        }
        await this.audit.record({
          actor: 'SYSTEM',
          action: 'PAYMENT_CONFIRMED',
          entityType: 'Booking',
          entityId: booking.id,
          metadata: { paymentId: fresh.id, gatewayPaymentId: params.gatewayPaymentId, via: params.via },
        });
        if (params.via !== 'WEBHOOK') {
          // The webhook did not get there first: worth knowing, because a webhook that never arrives usually means a broken setup.
          await this.audit.record({
            actor: 'SYSTEM',
            action: 'PAYMENT_CONFIRMED_WITHOUT_WEBHOOK',
            entityType: 'Booking',
            entityId: booking.id,
            metadata: { paymentId: fresh.id, via: params.via },
          });
        }
        await this.afterConfirmed(booking);
        return 'confirmed';
      }

      // The slot is gone (expired, failed, cancelled) or the amount is wrong. A booking that merely ran out of time (hold expired or the
      // processing window passed) is put back if its slot is still free; everything else is refunded as Coins.
      const lostByTime = booking.status === 'FAILED' || (booking.status === 'CANCELLED' && booking.cancellationReasonCode === 'HOLD_EXPIRED');
      if (lostByTime && !mismatch) {
        const honoured = await this.payments.honourLatePaymentAtomic({
          paymentId: fresh.id,
          paymentStatus: fresh.status,
          gatewayPaymentId: params.gatewayPaymentId,
          rawPayload: params.rawPayload,
          bookingId: booking.id,
          bookingStatus: booking.status,
          slotHoldId: slotHold.id,
          paidAmount: fresh.amount,
          confirmedVia: params.via,
        });
        if (honoured) {
          await this.audit.record({
            actor: 'SYSTEM',
            action: 'PAYMENT_LATE_SUCCESS_HONORED',
            entityType: 'Booking',
            entityId: booking.id,
            metadata: { paymentId: fresh.id, via: params.via },
          });
          await this.afterConfirmed(booking);
          return 'honoured';
        }
      }

      const refund = await this.payments.recordLatePaymentAtomic({
        paymentId: fresh.id,
        paymentStatus: fresh.status,
        gatewayPaymentId: params.gatewayPaymentId,
        rawPayload: params.rawPayload,
        bookingId: booking.id,
        bookingStatus: booking.status,
        bookingAmount: refundAmount,
        bookingCurrency: booking.currency,
        cancelBooking: booking.status === 'PENDING_PAYMENT' || booking.status === 'PROCESSING',
      });
      // Outside the transaction above, same reasoning as BookingsService.cancel: CoinsService does its own wallet-row locking,
      // PENDING is a safe intermediate state, and the idempotency key rules out a double credit if this step retries.
      await this.coins.completeRefund(refund.id);
      await this.audit.record({
        actor: 'SYSTEM',
        action: mismatch ? 'PAYMENT_AMOUNT_MISMATCH' : 'PAYMENT_LATE_SUCCESS_NOT_HONORED',
        entityType: 'Booking',
        entityId: booking.id,
        metadata: {
          paymentId: fresh.id,
          bookingStatusAtCapture: booking.status,
          slotHoldStatusAtCapture: slotHold.status,
          expectedMinor: toMinor(fresh.amount),
          capturedMinor: params.amountMinorUnits,
        },
      });
      if (booking.customerId) {
        await this.notifyLateRefund(booking.customerId, booking.orderId, String(refundAmount)).catch(() => undefined);
      }
      await this.notifications
        .notifyOrganizationOwners(booking.venue.organizationId, {
          type: 'SYSTEM',
          title: 'Payment received — booking not honored',
          message: `A payment for booking ${booking.orderId} arrived after the slot was released; it has been refunded as Coins to the customer.`,
          data: { bookingId: booking.id, orderId: booking.orderId, venueId: booking.venueId, resourceId: booking.resourceId },
        })
        .catch(() => undefined);
      return 'refunded';
    }
    return 'unknown';
  }

  /** What follows a booking becoming CONFIRMED, however it got there: the customer's message and the owners' notification. */
  private async afterConfirmed(booking: { id: string; customerId: string | null; orderId: string; venueId: string; resourceId: string | null; venue: { organizationId: string } }) {
    // Awaited (errors swallowed) rather than fire-and-forget, so message order stays right and a notification failure can never
    // undo an already-committed confirmation.
    if (booking.customerId) await this.notifyBookingConfirmed(booking.customerId, booking.orderId).catch(() => undefined);
    await this.notifications
      .notifyOrganizationOwners(booking.venue.organizationId, {
        type: 'BOOKING_CONFIRMED',
        title: 'Booking confirmed',
        message: `Booking ${booking.orderId} confirmed — payment received.`,
        data: { bookingId: booking.id, orderId: booking.orderId, venueId: booking.venueId, resourceId: booking.resourceId },
      })
      .catch(() => undefined);
  }

  /** A captured wallet recharge: the wallet is credited once, whichever path reports it first. */
  private async settleTopup(
    topup: NonNullable<Awaited<ReturnType<PaymentsRepository['findWalletTopupByOrderId']>>>,
    params: { gatewayPaymentId: string | undefined; amountMinorUnits?: number; currency?: string; rawPayload: unknown; via: SettleVia },
  ): Promise<SettleOutcome> {
    if (topup.status === 'SUCCESS') return 'already';
    const mismatch =
      (params.amountMinorUnits !== undefined && params.amountMinorUnits !== toMinor(topup.amount)) ||
      (params.currency !== undefined && params.currency.toUpperCase() !== topup.currency.toUpperCase());
    if (mismatch) {
      await this.payments.closeWalletTopup(topup.id, 'FAILED', 'The captured amount did not match the top-up');
      await this.audit.record({
        actor: 'SYSTEM',
        action: 'TOPUP_AMOUNT_MISMATCH',
        entityType: 'WalletTopup',
        entityId: topup.id,
        metadata: { expectedMinor: toMinor(topup.amount), capturedMinor: params.amountMinorUnits },
      });
      return 'unknown';
    }
    await this.coins.creditTopup({
      topupId: topup.id,
      customerId: topup.customerId,
      amount: topup.amount,
      gatewayPaymentId: params.gatewayPaymentId,
      confirmedVia: params.via,
    });
    await this.audit.record({
      actor: 'SYSTEM',
      action: 'WALLET_TOPUP_CREDITED',
      entityType: 'WalletTopup',
      entityId: topup.id,
      metadata: { amount: String(topup.amount), via: params.via },
    });
    return 'topup';
  }

  /** The wallet recharge (Coins bought with money). Never refunded to the card: Coins only leave as bookings. */
  async createTopup(amount: number, actor: AuthContext) {
    const env = loadEnv();
    if (!Number.isFinite(amount) || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      throw new BadRequestException('Enter an amount with at most two decimals.');
    }
    if (amount < env.WALLET_TOPUP_MIN || amount > env.WALLET_TOPUP_MAX) {
      throw new BadRequestException(`You can add between ${env.WALLET_TOPUP_MIN} and ${env.WALLET_TOPUP_MAX} at a time.`);
    }
    const order = await this.provider.createOrder({
      amountMinorUnits: toMinor(amount),
      currency: 'INR',
      receipt: `TOPUP-${Date.now().toString(36)}`,
    });
    const topup = await this.payments.createWalletTopup({ customerId: actor.id, amount, currency: 'INR', gatewayOrderId: order.gatewayOrderId });
    return { topupId: topup.id, gatewayOrderId: order.gatewayOrderId, amount, currency: 'INR' };
  }

  async getTopup(id: string, actor: AuthContext) {
    const topup = await this.payments.findWalletTopupById(id);
    if (!topup) throw new NotFoundException('Top-up not found');
    if (topup.customerId !== actor.id) throw new ForbiddenException('Not your top-up');
    // The polling page asks the gateway too, so a recharge never waits on the webhook.
    if (topup.status === 'PENDING') await this.settleFromGateway(topup.gatewayOrderId, topup.gatewayPaymentId ?? undefined, 'CLIENT');
    const after = (await this.payments.findWalletTopupById(id)) ?? topup;
    return { id: after.id, status: after.status, amount: after.amount, currency: after.currency };
  }

  /** The checkout page asks this while it waits: it re-checks with the gateway, so confirming never depends on the webhook. */
  async syncBooking(bookingId: string, actor: AuthContext) {
    const booking = await this.payments.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) throw new ForbiddenException("Cannot access another customer's booking");
    if (booking.status === 'PROCESSING' || booking.status === 'PENDING_PAYMENT') {
      const open = await this.payments.findOpenRazorpayPayment(bookingId);
      if (open?.gatewayOrderId && (open.status === 'PROCESSING' || booking.status === 'PROCESSING')) {
        await this.settleFromGateway(open.gatewayOrderId, open.gatewayPaymentId ?? undefined, 'CLIENT');
      }
    }
    const after = await this.payments.findBookingById(bookingId);
    return { status: after?.status ?? booking.status, processingUntil: after?.processingUntil ?? null };
  }

  private async notifyBookingConfirmed(customerId: string, orderId: string): Promise<void> {
    const customer = await this.payments.findCustomerById(customerId);
    // WhatsApp goes only to a number the customer has verified, never one that was merely typed in.
    if (!customer?.whatsappNumber || !customer.phoneVerified) return;
    await this.messenger.bookingConfirmed(customer.whatsappNumber, orderId);
  }

  private async notifyLateRefund(customerId: string, orderId: string, coins: string): Promise<void> {
    const customer = await this.payments.findCustomerById(customerId);
    if (!customer?.whatsappNumber || !customer.phoneVerified) return;
    await this.messenger.latePaymentRefunded(customer.whatsappNumber, orderId, coins);
  }

  /** Platform-wide listing for the Super Admin Portal (§12). */
  async listPaymentsForAdmin(filters: AdminPaymentFilters & { limit?: number; offset?: number }) {
    return this.payments.listPaymentsForAdmin(filters);
  }

  async countPaymentsForAdmin(filters: AdminPaymentFilters) {
    return this.payments.countPaymentsForAdmin(filters);
  }

  async listRefundsForAdmin(filters: AdminRefundFilters & { limit?: number; offset?: number }) {
    return this.payments.listRefundsForAdmin(filters);
  }

  async countRefundsForAdmin(filters: AdminRefundFilters) {
    return this.payments.countRefundsForAdmin(filters);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handlePaymentFailed(payload: any) {
    const entity = payload?.payload?.payment?.entity;
    const gatewayOrderId: string | undefined = entity?.order_id;
    if (!gatewayOrderId) return;

    const topup = await this.payments.findWalletTopupByOrderId(gatewayOrderId);
    if (topup) {
      // The customer can retry on the same order, so a failed attempt only closes it for now; a later capture still credits it.
      await this.payments.closeWalletTopup(topup.id, 'FAILED', entity?.error_description ?? 'Payment failed');
      return;
    }

    const payment = await this.payments.findFailedPaymentView(gatewayOrderId);
    // Only an attempt nobody has reported as paid is failed: a PROCESSING one is waiting for its own confirmation.
    if (!payment || payment.status !== 'PENDING') return; // already resolved — safe no-op
    // The popup is still open for a retry (a declined card): the booking's own window decides how long it waits.
    if (payment.booking.status === 'PROCESSING') return;

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

  // ---------------------------------------------------------------------------------------------------------------------
  // The reconciler: the safety net behind the webhook (called every minute by PaymentReconcilerService).
  // ---------------------------------------------------------------------------------------------------------------------

  /** Settles bookings in the PROCESSING window: confirm what the gateway captured, fail what it did not once the window is over. */
  async reconcileProcessing(): Promise<{ confirmed: number; failed: number }> {
    let confirmed = 0;
    let failed = 0;
    for (const booking of await this.payments.listProcessing()) {
      try {
        for (const payment of booking.payments) {
          if (payment.provider !== 'RAZORPAY' || !payment.gatewayOrderId || !['PENDING', 'PROCESSING'].includes(payment.status)) continue;
          await this.settleFromGateway(payment.gatewayOrderId, payment.gatewayPaymentId ?? undefined, 'RECONCILER');
        }
        const now = await this.payments.findBookingById(booking.id);
        if (now?.status === 'CONFIRMED') {
          confirmed++;
          continue;
        }
        // The window is over and (after the last look above) nothing was captured: the booking fails and the slot is released.
        if (now?.status === 'PROCESSING' && now.processingUntil && now.processingUntil.getTime() <= Date.now()) {
          if (await this.payments.failProcessingAtomic({ bookingId: booking.id, slotHoldId: booking.slotHoldId })) {
            failed++;
            await this.audit.record({
              actor: 'SYSTEM',
              action: 'PAYMENT_NOT_CONFIRMED',
              entityType: 'Booking',
              entityId: booking.id,
              metadata: { processingUntil: now.processingUntil.toISOString() },
            });
          }
        }
      } catch (error) {
        this.logger.error(`Reconciling booking ${booking.id} failed: ${(error as Error).message}`);
      }
    }
    return { confirmed, failed };
  }

  /** Old unfinished payments and recharges: a capture whose webhook never came is found here; abandoned ones are closed. */
  async reconcileStale(): Promise<{ settled: number; closed: number }> {
    let settled = 0;
    let closed = 0;
    const env = loadEnv();
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
    for (const payment of await this.payments.listStalePendingPayments(twoMinutesAgo)) {
      try {
        if (!payment.gatewayOrderId) continue;
        const outcome = await this.settleFromGateway(payment.gatewayOrderId, payment.gatewayPaymentId ?? undefined, 'RECONCILER');
        if (outcome) {
          settled++;
          continue;
        }
        const tooOld = Date.now() - payment.createdAt.getTime() > env.PAYMENT_MAX_HOLD_MINUTES * 60_000;
        if (tooOld && payment.booking.status !== 'PROCESSING') {
          await this.payments.closePayment(payment.id, payment.status, 'EXPIRED', 'Never completed');
          closed++;
        }
      } catch (error) {
        this.logger.error(`Reconciling payment ${payment.id} failed: ${(error as Error).message}`);
      }
    }
    for (const topup of await this.payments.listStalePendingTopups(twoMinutesAgo)) {
      try {
        const outcome = await this.settleFromGateway(topup.gatewayOrderId, topup.gatewayPaymentId ?? undefined, 'RECONCILER');
        if (outcome) {
          settled++;
          continue;
        }
        if (Date.now() - topup.createdAt.getTime() > 30 * 60_000) {
          await this.payments.closeWalletTopup(topup.id, 'EXPIRED', 'Never completed');
          closed++;
        }
      } catch (error) {
        this.logger.error(`Reconciling top-up ${topup.id} failed: ${(error as Error).message}`);
      }
    }
    return { settled, closed };
  }
}
