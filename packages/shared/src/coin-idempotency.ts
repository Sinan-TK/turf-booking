import { CoinTransactionType } from './enums';

/**
 * Deterministic idempotency keys for CoinTransaction rows
 * (ARCHITECTURE.md §5.2, §10). Never client-supplied — always derived from
 * the operation that causes the credit/debit, so retrying the same
 * operation can only ever produce one ledger row (enforced by a unique
 * constraint on CoinTransaction.idempotencyKey).
 */
export function coinIdempotencyKey(type: CoinTransactionType, referenceId: string): string {
  switch (type) {
    case CoinTransactionType.BOOKING_REWARD:
      return `booking-reward:${referenceId}`;
    case CoinTransactionType.BOOKING_REDEMPTION:
      return `redemption:${referenceId}`;
    case CoinTransactionType.REFUND:
      return `refund:${referenceId}`;
    case CoinTransactionType.PROMOTION:
      return `promotion:${referenceId}`;
    case CoinTransactionType.REFERRAL:
      return `referral:${referenceId}`;
    case CoinTransactionType.ADMIN_ADJUSTMENT:
      return `admin-adjustment:${referenceId}`;
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unhandled CoinTransactionType: ${exhaustiveCheck}`);
    }
  }
}
