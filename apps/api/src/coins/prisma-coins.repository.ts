import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { coinIdempotencyKey } from '@venue/shared';
import { Prisma } from '@venue/database';
import type {
  BookingStatus,
  CoinTransactionType,
  RefundStatus,
  SlotHoldStatus,
} from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import type { CoinsRepository, LedgerEntryInput } from './coins.repository';

/**
 * Prisma-backed CoinsRepository. The ONLY file in the coins module
 * allowed to touch PrismaService. The core ledger write (§10) lives here:
 * SELECT ... FOR UPDATE on the wallet row serializes concurrent
 * credit/debit attempts, and the deterministic idempotency key is the
 * second, independent safety net — a retried call is a no-op replay.
 */
@Injectable()
export class PrismaCoinsRepository implements CoinsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findWalletByCustomerId(customerId: string) {
    return this.prisma.client.coinWallet.findUnique({ where: { customerId } });
  }

  listTransactions(customerId: string) {
    return this.prisma.client.coinTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOpenTopups(customerId: string) {
    return this.prisma.client.walletTopup.findMany({
      where: { customerId, status: { not: 'SUCCESS' } },
      select: { id: true, amount: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  findBookingById(id: string) {
    return this.prisma.client.booking.findUnique({ where: { id } });
  }

  findSlotHoldById(id: string) {
    return this.prisma.client.slotHold.findUniqueOrThrow({ where: { id } });
  }

  findCustomerById(id: string) {
    return this.prisma.client.customerProfile.findUnique({ where: { id } });
  }

  findRefundById(id: string) {
    return this.prisma.client.refund.findUniqueOrThrow({ where: { id } });
  }

  private async applyLedgerEntry(tx: Prisma.TransactionClient, params: LedgerEntryInput) {
    const type = params.type as CoinTransactionType;
    const idempotencyKey = coinIdempotencyKey(type, params.referenceId);

    const existing = await tx.coinTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return existing; // already applied — safe no-op replay

    const [wallet] = await tx.$queryRaw<Array<{ id: string; cachedBalance: Prisma.Decimal }>>`
      SELECT id, "cachedBalance" FROM coin_wallets WHERE "customerId" = ${params.customerId}::uuid FOR UPDATE
    `;
    if (!wallet) throw new NotFoundException('Wallet not found');

    const amount = new Prisma.Decimal(params.amount);
    const newBalance = wallet.cachedBalance.add(amount);
    if (newBalance.isNegative()) {
      throw new BadRequestException('Insufficient Coin balance');
    }

    const transaction = await tx.coinTransaction.create({
      data: {
        walletId: wallet.id,
        customerId: params.customerId,
        type,
        amount,
        balanceAfter: newBalance,
        bookingId: ['BOOKING_REWARD', 'BOOKING_REDEMPTION'].includes(type)
          ? params.referenceId
          : undefined,
        refundId: type === 'REFUND' ? params.referenceId : undefined,
        walletTopupId: type === 'WALLET_TOPUP' ? params.referenceId : undefined,
        idempotencyKey,
        createdByAdminId: params.createdByAdminId,
      },
    });
    await tx.coinWallet.update({ where: { id: wallet.id }, data: { cachedBalance: newBalance } });
    return transaction;
  }

  async redeemBookingAtomic(params: {
    bookingId: string;
    expectedBookingStatus: string;
    slotHoldId: string;
    expectedSlotHoldStatus: string;
    customerId: string;
    debitAmount: Prisma.Decimal | number | string;
    amount: Prisma.Decimal | number | string;
    currency: string;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      await this.applyLedgerEntry(tx, {
        customerId: params.customerId,
        type: 'BOOKING_REDEMPTION',
        amount: params.debitAmount,
        referenceId: params.bookingId,
      });

      // Mirrors PaymentsService's confirm transaction (kept intentionally
      // parallel rather than sharing a helper — this path has no "late
      // arrival" branch to reconcile, so the shapes diverge slightly;
      // keep both in sync if the Booking/SlotHold/ResourceLock confirm
      // sequence ever changes).
      const updatedBooking = await tx.booking.update({
        where: { id: params.bookingId, status: params.expectedBookingStatus as BookingStatus },
        data: { status: 'CONFIRMED', paymentMethod: 'COINS', paidAmount: params.amount, coinsPaid: params.amount, moneyPaid: 0, processingUntil: null },
      });
      await tx.slotHold.update({
        where: { id: params.slotHoldId, status: params.expectedSlotHoldStatus as SlotHoldStatus },
        data: { status: 'CONFIRMED' },
      });
      await tx.resourceLock.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'CONFIRMED' },
      });
      // No-op for exclusive holds; confirms pooled reservations (same
      // keep-in-sync rule as the payments confirm path above).
      await tx.inventoryReservation.updateMany({
        where: { slotHoldId: params.slotHoldId },
        data: { status: 'CONFIRMED' },
      });

      // A Payment row (provider=COINS) is created for uniform reporting
      // alongside Razorpay payments (§9's coin payment path) — owner
      // portal payment lists don't need to special-case the method.
      await tx.payment.create({
        data: {
          bookingId: params.bookingId,
          provider: 'COINS',
          amount: params.amount,
          currency: params.currency,
          status: 'SUCCESS',
        },
      });

      return updatedBooking;
    });
  }

  async completeRefundAtomic(params: {
    refundId: string;
    expectedRefundStatus: string;
    customerId: string;
    creditAmount: Prisma.Decimal | number | string;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: params.refundId, status: params.expectedRefundStatus as RefundStatus },
        data: { status: 'PROCESSING' },
      });
      await this.applyLedgerEntry(tx, {
        customerId: params.customerId,
        type: 'REFUND',
        amount: params.creditAmount,
        referenceId: params.refundId,
      });
      return tx.refund.update({
        where: { id: params.refundId, status: 'PROCESSING' },
        data: { status: 'COMPLETED' },
      });
    });
  }

  /**
   * A wallet recharge the gateway has captured: the top-up turns SUCCESS and the wallet is credited in ONE transaction. Replaying it
   * (webhook, client confirmation and reconciler all arrive at this) finds the ledger row by its key and changes nothing.
   */
  async creditTopupAtomic(params: {
    topupId: string;
    customerId: string;
    amount: Prisma.Decimal | number | string;
    gatewayPaymentId: string | undefined;
    confirmedVia: string;
  }) {
    return this.prisma.client.$transaction(async (tx) => {
      const topup = await tx.walletTopup.findUniqueOrThrow({ where: { id: params.topupId } });
      if (topup.status !== 'SUCCESS') {
        await tx.walletTopup.update({
          where: { id: params.topupId },
          data: {
            status: 'SUCCESS',
            gatewayPaymentId: params.gatewayPaymentId ?? topup.gatewayPaymentId,
            confirmedVia: params.confirmedVia as 'WEBHOOK' | 'CLIENT' | 'RECONCILER',
          },
        });
      }
      return this.applyLedgerEntry(tx, {
        customerId: params.customerId,
        type: 'WALLET_TOPUP',
        amount: params.amount,
        referenceId: params.topupId,
      });
    });
  }

  adminAdjustAtomic(entry: LedgerEntryInput) {
    return this.prisma.client.$transaction((tx) => this.applyLedgerEntry(tx, entry));
  }
}
