import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  RefundStatus,
  REFUND_TRANSITIONS,
  BOOKING_TRANSITIONS,
  SLOT_HOLD_TRANSITIONS,
} from '@venue/shared';
import { AuditService } from '../audit/audit.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import type { AuthContext } from '../auth/auth.types';
import { COINS_REPOSITORY, type CoinsRepository } from './coins.repository';

@Injectable()
export class CoinsService {
  constructor(
    @Inject(COINS_REPOSITORY) private readonly coins: CoinsRepository,
    private readonly audit: AuditService,
    @Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,
  ) {}

  async getWallet(customerId: string) {
    const wallet = await this.coins.findWalletByCustomerId(customerId);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getTransactions(customerId: string) {
    return this.coins.listTransactions(customerId);
  }

  /**
   * The COINS half of the payment-method rule (ARCHITECTURE.md §9's
   * "Payment Method Rule" — money and coins are mutually exclusive by
   * construction: this is a wholly separate endpoint/method from the
   * Razorpay flow, never a partial-amount blend). Synchronous — unlike
   * the Razorpay webhook path, there's no external gateway round-trip
   * or "late arrival" case to handle; either this call succeeds and
   * confirms the booking in one transaction, or it fails and nothing
   * changes.
   */
  async redeemForBooking(bookingId: string, actor: AuthContext) {
    const booking = await this.coins.findBookingById(bookingId);
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== actor.id) {
      throw new BadRequestException("Cannot pay for another customer's booking");
    }
    const slotHold = await this.coins.findSlotHoldById(booking.slotHoldId);
    // No "late arrival" branch here (unlike PaymentsService) — this call
    // is synchronous, so an ineligible state just means the hold expired
    // or the booking was already resolved between page load and this
    // click; assertTransition's error surfaces as a normal 4xx.
    assertTransition('Booking', BOOKING_TRANSITIONS, booking.status, 'CONFIRMED');
    assertTransition('SlotHold', SLOT_HOLD_TRANSITIONS, slotHold.status, 'CONFIRMED');

    const result = await this.coins.redeemBookingAtomic({
      bookingId: booking.id,
      expectedBookingStatus: booking.status,
      slotHoldId: slotHold.id,
      expectedSlotHoldStatus: slotHold.status,
      customerId: actor.id,
      debitAmount: booking.amount.neg(),
      amount: booking.amount,
      currency: booking.currency,
    });

    await this.audit.record({
      actor,
      action: 'BOOKING_PAID_WITH_COINS',
      entityType: 'Booking',
      entityId: bookingId,
      metadata: { amount: booking.amount.toString() },
    });

    // Best-effort and awaited (not fire-and-forget), mirroring
    // PaymentsService's confirmation notification and
    // BookingsService.cancel's — see the latter for the message-ordering
    // bug that pattern fixes.
    const customer = await this.coins.findCustomerById(actor.id);
    if (customer) {
      await this.messenger
        .bookingConfirmed(customer.whatsappNumber, booking.orderId)
        .catch(() => undefined);
    }

    return result;
  }

  /**
   * Completes a PENDING Refund (created by BookingsService.cancel or
   * PaymentsService's late-arrival handling) by actually crediting the
   * coins — the piece those two call sites explicitly deferred to this
   * module. Runs the PROCESSING step inline rather than as a separate
   * async hop: crediting a ledger is a pure DB operation with no
   * external gateway call, so there's nothing to wait on.
   */
  async completeRefund(refundId: string) {
    const refund = await this.coins.findRefundById(refundId);
    if (refund.status === RefundStatus.COMPLETED) return refund; // already done — safe no-op
    assertTransition('Refund', REFUND_TRANSITIONS, refund.status, RefundStatus.PROCESSING);

    const booking = await this.coins.findBookingById(refund.bookingId);
    if (!booking) throw new NotFoundException('Booking not found');

    const completed = await this.coins.completeRefundAtomic({
      refundId: refund.id,
      expectedRefundStatus: refund.status,
      customerId: booking.customerId,
      creditAmount: refund.coinAmountCredited,
    });

    await this.audit.record({
      actor: 'SYSTEM',
      action: 'REFUND_COMPLETED',
      entityType: 'Refund',
      entityId: refund.id,
      metadata: { coinAmountCredited: refund.coinAmountCredited.toString(), bookingId: booking.id },
    });

    return completed;
  }

  /**
   * The only coin-mutating path an admin can reach directly — Venue
   * Owners have no equivalent endpoint anywhere in the app
   * (ARCHITECTURE.md §12: "owners cannot arbitrarily create/deduct Venue
   * Coins").
   */
  async adminAdjust(customerId: string, signedAmount: number, reason: string, admin: AuthContext) {
    const referenceId = `${customerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const result = await this.coins.adminAdjustAtomic({
      customerId,
      type: 'ADMIN_ADJUSTMENT',
      amount: signedAmount,
      referenceId,
      createdByAdminId: admin.id,
    });
    await this.audit.record({
      actor: admin,
      action: 'ADMIN_COIN_ADJUSTMENT',
      entityType: 'CoinWallet',
      entityId: customerId,
      metadata: { signedAmount, reason },
    });
    return result;
  }
}
