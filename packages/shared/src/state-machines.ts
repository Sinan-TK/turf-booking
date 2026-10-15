import {
  BookingSessionStatus,
  BookingStatus,
  PaymentStatus,
  RefundStatus,
  SlotHoldStatus,
} from './enums';

/**
 * Legal state transitions for every state machine in the system
 * (ARCHITECTURE.md §7). Services must call `assertTransition` before
 * writing a new status — never set `status` directly. The DB update itself
 * additionally guards with `WHERE status = <from>` so a concurrent writer
 * can't race past this check (see ARCHITECTURE.md §6.3, §9).
 */

type TransitionMap<S extends string> = Record<S, readonly S[]>;

export const BOOKING_SESSION_TRANSITIONS: TransitionMap<BookingSessionStatus> = {
  ACTIVE: [
    BookingSessionStatus.EXPIRED,
    BookingSessionStatus.COMPLETED,
    BookingSessionStatus.CANCELLED,
  ],
  EXPIRED: [],
  COMPLETED: [],
  CANCELLED: [],
};

export const SLOT_HOLD_TRANSITIONS: TransitionMap<SlotHoldStatus> = {
  HELD: [SlotHoldStatus.CONFIRMED, SlotHoldStatus.EXPIRED, SlotHoldStatus.RELEASED],
  CONFIRMED: [SlotHoldStatus.RELEASED],
  EXPIRED: [],
  RELEASED: [],
};

export const BOOKING_TRANSITIONS: TransitionMap<BookingStatus> = {
  PENDING_PAYMENT: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  CONFIRMED: [BookingStatus.CANCELLED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

export const PAYMENT_TRANSITIONS: TransitionMap<PaymentStatus> = {
  PENDING: [PaymentStatus.SUCCESS, PaymentStatus.FAILED],
  SUCCESS: [PaymentStatus.REFUNDED],
  FAILED: [],
  REFUNDED: [],
};

export const REFUND_TRANSITIONS: TransitionMap<RefundStatus> = {
  PENDING: [RefundStatus.PROCESSING],
  PROCESSING: [RefundStatus.COMPLETED, RefundStatus.FAILED],
  COMPLETED: [],
  FAILED: [RefundStatus.PROCESSING], // retryable by the reconciliation job
};

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly entity: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = 'IllegalStateTransitionError';
  }
}

export function assertTransition<S extends string>(
  entity: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  if (!map[from]?.includes(to)) {
    throw new IllegalStateTransitionError(entity, from, to);
  }
}
