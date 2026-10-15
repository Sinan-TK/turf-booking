import type {
  Booking,
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

/** Booking with the admin-detail includes (venue/customer/payments/refunds). */
export type BookingDetail = Prisma.BookingGetPayload<{
  include: {
    venue: { select: { id: true; name: true; facilityCode: true; organizationId: true } };
    resourceGroup: { select: { id: true; name: true; allocationMode: true; totalUnits: true } };
    customer: { select: { id: true; whatsappNumber: true; name: true } };
    payments: true;
    refunds: true;
  };
}>;

/** Booking with the list-view includes (venue/customer). */
export type BookingListItem = Prisma.BookingGetPayload<{
  include: {
    venue: { select: { id: true; name: true; facilityCode: true; organizationId: true } };
    customer: { select: { id: true; whatsappNumber: true; name: true } };
  };
}>;

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
  priceSnapshot: { amount: string; currency: string; durationMinutes: number };
  footprintIds: string[];
  durationMinutes: number;
  groundType: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
}

export interface OfflineAtomicParams extends HoldAtomicParams {
  paymentMethod: PaymentMethod;
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
  priceSnapshot: {
    amount: string;
    currency: string;
    durationMinutes: number;
    quantity: number;
    unitPrice: string;
  };
  durationMinutes: number;
  unitLabel: string;
  amount: Prisma.Decimal | number | string;
  currency: string;
}

export interface CancelAtomicParams {
  bookingId: string;
  expectedBookingStatus: string;
  slotHoldId: string;
  reason: string | undefined;
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
  findPricingRule(
    resourceId: string,
    durationMinutes: number,
    dayType: string,
    at: Date,
  ): Promise<PricingRule | null>;
  findResourceGroupById(id: string): Promise<ResourceGroup | null>;
  findGroupPricingRule(
    resourceGroupId: string,
    durationMinutes: number,
    dayType: string,
    at: Date,
  ): Promise<PricingRule | null>;
  sumHeldGroupQuantity(resourceGroupId: string, startTime: Date, endTime: Date): Promise<number>;
  findInventoryReservations(slotHoldId: string): Promise<InventoryReservation[]>;
  findBookingById(id: string): Promise<Booking | null>;
  findBookingDetailById(id: string): Promise<BookingDetail | null>;
  listForCustomer(customerId: string): Promise<Booking[]>;
  listForAdmin(filters: {
    status?: string;
    venueId?: string;
    organizationId?: string;
    limit?: number;
  }): Promise<BookingListItem[]>;
  listForOwner(
    organizationId: string,
    filters: { status?: string; venueId?: string; limit?: number },
  ): Promise<BookingListItem[]>;
  findCustomerById(id: string): Promise<CustomerProfile | null>;
  createHoldAtomic(params: HoldAtomicParams): Promise<Booking>;
  createPooledHoldAtomic(params: PooledHoldAtomicParams): Promise<Booking>;
  createOfflineAtomic(params: OfflineAtomicParams): Promise<Booking>;
  cancelAtomic(params: CancelAtomicParams): Promise<{ booking: Booking; refund: Refund | null }>;
}

export const BOOKINGS_REPOSITORY = Symbol('BOOKINGS_REPOSITORY');
