import type {
  Booking,
  BookingCancellationReasonCode,
  BookingStatus,
  CustomerProfile,
  InventoryReservation,
  PaymentMethod,
  Prisma,
  PricingRule,
  Resource,
  ResourceGroup,
  ResourceLock,
  Refund,
  Venue,
} from '@venue/database';
import type { DateRange } from '../common/list-filters';
import type { presentCustomer } from './booking-customer';

/** Booking with the admin-detail includes (venue/customer/payments/refunds). `customer` is the account, or the walk-in's recorded details. */
export type BookingDetail = ReturnType<typeof presentCustomer<BookingCustomerRow, RawBookingDetail>>;
type BookingCustomerRow = { id: string; whatsappNumber: string | null; phoneVerified: boolean; email: string | null; name: string | null };
type RawBookingDetail = Prisma.BookingGetPayload<{
  include: {
    venue: { select: { id: true; name: true; facilityCode: true; organizationId: true } };
    resourceGroup: { select: { id: true; name: true; allocationMode: true; totalUnits: true } };
    customer: { select: { id: true; whatsappNumber: true; phoneVerified: true; email: true; name: true } };
    payments: true;
    refunds: true;
  };
}>;

/** Booking with what the customer's checkout/receipt page shows. */
export type BookingCheckoutView = Prisma.BookingGetPayload<{
  include: {
    venue: { select: { id: true; name: true; facilityCode: true; address: true; googleMapsUrl: true; lat: true; lng: true; contactPhone: true; contactCall: true; contactWhatsapp: true; organization: { select: { contactPhone: true } }; photos: { select: { url: true } } } };
    resource: { select: { name: true; category: { select: { name: true; iconKey: true; iconSvg: true; unitLabel: true } }; photos: { select: { key: true } } } };
    resourceGroup: { select: { name: true; category: { select: { name: true; iconKey: true; iconSvg: true; unitLabel: true } }; photos: { select: { key: true } } } };
    slotHold: { select: { holdExpiresAt: true } };
  };
}>;

/** Booking with the list-view includes (venue/customer), presented like BookingDetail. */
export type BookingListItem = ReturnType<typeof presentCustomer<BookingCustomerRow, RawBookingListItem>>;
type RawBookingListItem = Prisma.BookingGetPayload<{
  include: {
    venue: { select: { id: true; name: true; facilityCode: true; organizationId: true } };
    customer: { select: { id: true; whatsappNumber: true; phoneVerified: true; email: true; name: true } };
  };
}>;

/** The columns the admin and owner booking lists can be sorted by. */
export const BOOKING_SORTS = ['created', 'start', 'order', 'venue', 'customer', 'amount', 'status'] as const;
export type BookingSort = (typeof BOOKING_SORTS)[number];

export interface AdminBookingFilters {
  status?: string;
  venueId?: string;
  /** Limits to these venues (a staff member's assignments); combined with venueId it is intersected by the caller. */
  venueIds?: string[];
  organizationId?: string;
  /** Matches order id, customer name/number, venue name/facility code. */
  search?: string;
  paymentMethod?: string;
  /** Window on the booking's start time. */
  startRange?: DateRange;
  /** What to sort by (default: when it was booked) and which way (default: the newest first). */
  sort?: BookingSort;
  dir?: 'asc' | 'desc';
}

export interface HoldAtomicParams {
  resourceId: string;
  customerId: string;
  venueId: string;
  /** The booking's own time. */
  startTime: Date;
  endTime: Date;
  holdExpiresAt: Date;
  /** Range the resource locks cover = booking time + policy buffers. */
  lockStartTime: Date;
  lockEndTime: Date;
  priceSnapshot: {
    amount: string;
    currency: string;
    durationMinutes: number;
    /** Length of one priced block (the unit's minimum booking length). */
    blockMinutes?: number;
    normalPrice?: string;
    offerPrice?: string | null;
    bookingPrice?: string;
    /** The price of each block of the booking, as it was when booked. */
    blocks?: Array<{ start: string; amount: string; normalAmount: string | null; bookingPrice: string }>;
  };
  footprintIds: string[];
  durationMinutes: number;
  groundType: string;
  /** The full price. */
  amount: Prisma.Decimal | number | string;
  /** The part charged online to hold the slot (0 for an offline walk-in). */
  advanceAmount: Prisma.Decimal | number | string;
  currency: string;
  /** Resolved commercial terms the booking is made under (none for walk-ins). */
  commercialTerms?: Prisma.InputJsonValue;
}

export interface OfflineAtomicParams extends Omit<HoldAtomicParams, 'customerId'> {
  /** A walk-in has no customer account: who it is for is kept on the booking itself. */
  walkIn: { name: string | null; phone: string };
  paymentMethod: PaymentMethod;
  /** What was collected at booking time (the rest is due at the venue). */
  paidAmount: Prisma.Decimal | number | string;
}

/**
 * P2 pooled-inventory hold: one SlotHold + one InventoryReservation
 * against a POOLED ResourceGroup (no ResourceLock rows — exclusion is
 * binary occupancy and cannot count). The group row is locked
 * SELECT ... FOR UPDATE inside the transaction and the overlapping
 * HELD/CONFIRMED quantity sum re-checked there; oversell throws a
 * ConflictException the service passes through as the 409.
 */
export interface PooledHoldAtomicParams {
  resourceGroupId: string;
  quantity: number;
  customerId: string;
  venueId: string;
  startTime: Date;
  endTime: Date;
  holdExpiresAt: Date;
  /** How many the time asked for can hold: a fixed slot's own count; omitted = the whole group's `totalUnits`. */
  capacity?: number;
  priceSnapshot: {
    amount: string;
    currency: string;
    durationMinutes: number;
    quantity: number;
    unitPrice: string;
    bookingPrice?: string;
  };
  durationMinutes: number;
  unitLabel: string;
  amount: Prisma.Decimal | number | string;
  advanceAmount: Prisma.Decimal | number | string;
  currency: string;
  commercialTerms: Prisma.InputJsonValue;
}

export interface CancelAtomicParams {
  bookingId: string;
  expectedBookingStatus: string;
  slotHoldId: string;
  reason: string | undefined;
  reasonCode: BookingCancellationReasonCode;
  /** A late cancellation's owner/platform split, written in the same transaction. */
  settlementData?: Prisma.BookingSettlementUncheckedCreateInput | null;
  refundData:
    | {
        originalAmount: Prisma.Decimal | number | string;
        originalCurrency: string;
        coinAmountCredited: Prisma.Decimal | number | string;
        policySnapshot: Prisma.InputJsonValue;
      }
    | null;
}

/**
 * Clean-Architecture port: BookingsService (use-case) depends on this
 * interface, never on Prisma directly. PrismaBookingsRepository is the
 * only file in this module allowed to touch PrismaService.
 *
 * The three *Atomic writers each own exactly one $transaction — the
 * ResourceLock exclusion constraint only guards races when all writes
 * happen atomically, so these must never be split by callers.
 */
export interface BookingsRepository {
  findResourceById(id: string): Promise<Resource | null>;
  findVenueById(id: string): Promise<Venue | null>;
  findOverlappingLock(
    footprintIds: string[],
    startTime: Date,
    endTime: Date,
  ): Promise<ResourceLock | null>;
  /** Every rule for the unit and duration already in effect at `at`; the caller picks the one for the slot. */
  findPricingRules(resourceId: string, at: Date): Promise<PricingRule[]>;
  findResourceGroupById(id: string): Promise<ResourceGroup | null>;
  findGroupPricingRules(resourceGroupId: string, durationMinutes: number, at: Date): Promise<PricingRule[]>;
  sumHeldGroupQuantity(resourceGroupId: string, startTime: Date, endTime: Date): Promise<number>;
  findInventoryReservations(slotHoldId: string): Promise<InventoryReservation[]>;
  findBookingById(id: string): Promise<Booking | null>;
  /** Adds money collected (at the venue) to what the booking has been paid so far. */
  addPaidAmount(id: string, delta: Prisma.Decimal | number | string): Promise<Booking>;
  /**
   * Records whether the customer came: moves a booking from one of the `from` statuses to COMPLETED or NO_SHOW, and relabels its
   * settlement (played / no-show) in the same step. False when the booking was no longer in one of `from` (someone else changed it).
   */
  setAttendance(id: string, from: BookingStatus[], to: 'COMPLETED' | 'NO_SHOW'): Promise<boolean>;
  findBookingDetailById(id: string): Promise<BookingDetail | null>;
  findBookingCheckoutViewById(id: string): Promise<BookingCheckoutView | null>;
  listForCustomer(customerId: string): Promise<Booking[]>;
  listForAdmin(filters: AdminBookingFilters & { limit?: number; offset?: number }): Promise<BookingListItem[]>;
  countForAdmin(filters: AdminBookingFilters): Promise<number>;
  findCustomerById(id: string): Promise<CustomerProfile | null>;
  createHoldAtomic(params: HoldAtomicParams): Promise<Booking>;
  createPooledHoldAtomic(params: PooledHoldAtomicParams): Promise<Booking>;
  createOfflineAtomic(params: OfflineAtomicParams): Promise<Booking>;
  cancelAtomic(params: CancelAtomicParams): Promise<{ booking: Booking; refund: Refund | null }>;
}

export const BOOKINGS_REPOSITORY = Symbol('BOOKINGS_REPOSITORY');
