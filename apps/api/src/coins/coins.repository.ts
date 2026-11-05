import type {
  Booking,
  CoinTransaction,
  CoinWallet,
  CustomerProfile,
  Prisma,
  Refund,
  SlotHold,
} from '@venue/database';

export interface LedgerEntryInput {
  customerId: string;
  /** CoinTransactionType as a plain string — the adapter casts to the enum. */
  type: string;
  /** Signed: +credit / -debit. */
  amount: Prisma.Decimal | number | string;
  referenceId: string;
  createdByAdminId?: string;
}

/**
 * Clean-Architecture port: CoinsService (use-case) depends on this
 * interface, never on Prisma directly. PrismaCoinsRepository is the only
 * file in this module allowed to touch PrismaService — including the raw
 * SELECT ... FOR UPDATE that serializes concurrent ledger writes.
 */
export interface CoinsRepository {
  findWalletByCustomerId(customerId: string): Promise<CoinWallet | null>;
  listTransactions(customerId: string): Promise<CoinTransaction[]>;
  /** Recharges that are not (yet) credited: still waiting, failed or abandoned. */
  listOpenTopups(customerId: string): Promise<Array<{ id: string; amount: Prisma.Decimal; status: string; createdAt: Date }>>;
  findBookingById(id: string): Promise<Booking | null>;
  findSlotHoldById(id: string): Promise<SlotHold>;
  findCustomerById(id: string): Promise<CustomerProfile | null>;
  findRefundById(id: string): Promise<Refund>;
  redeemBookingAtomic(params: {
    bookingId: string;
    expectedBookingStatus: string;
    slotHoldId: string;
    expectedSlotHoldStatus: string;
    customerId: string;
    /** Already signed (negative) debit amount. */
    debitAmount: Prisma.Decimal | number | string;
    /** Original booking amount for the COINS Payment reporting row. */
    amount: Prisma.Decimal | number | string;
    currency: string;
  }): Promise<Booking>;
  completeRefundAtomic(params: {
    refundId: string;
    expectedRefundStatus: string;
    customerId: string;
    creditAmount: Prisma.Decimal | number | string;
  }): Promise<Refund>;
  adminAdjustAtomic(entry: LedgerEntryInput): Promise<CoinTransaction>;
  creditTopupAtomic(params: {
    topupId: string;
    customerId: string;
    amount: Prisma.Decimal | number | string;
    gatewayPaymentId: string | undefined;
    confirmedVia: string;
  }): Promise<CoinTransaction>;
}

export const COINS_REPOSITORY = Symbol('COINS_REPOSITORY');
