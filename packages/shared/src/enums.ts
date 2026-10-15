/**
 * Plain TypeScript mirrors of the Prisma schema enums (packages/database),
 * safe to import from frontend apps that must not depend on the Prisma
 * client. Keep these in sync with schema.prisma by hand — Prisma enums are
 * the source of truth for the database; these are the source of truth for
 * anything that runs in a browser.
 */

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  VENUE_OWNER: 'VENUE_OWNER',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const OwnerUserRole = {
  OWNER_ADMIN: 'OWNER_ADMIN',
  OWNER_STAFF: 'OWNER_STAFF',
} as const;
export type OwnerUserRole = (typeof OwnerUserRole)[keyof typeof OwnerUserRole];

export const BookingSessionStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type BookingSessionStatus = (typeof BookingSessionStatus)[keyof typeof BookingSessionStatus];

export const SlotHoldStatus = {
  HELD: 'HELD',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
} as const;
export type SlotHoldStatus = (typeof SlotHoldStatus)[keyof typeof SlotHoldStatus];

export const BookingStatus = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentProviderType = {
  RAZORPAY: 'RAZORPAY',
  COINS: 'COINS',
} as const;
export type PaymentProviderType = (typeof PaymentProviderType)[keyof typeof PaymentProviderType];

export const PaymentMethod = {
  MONEY: 'MONEY',
  COINS: 'COINS',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const RefundStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus];

export const CoinTransactionType = {
  BOOKING_REWARD: 'BOOKING_REWARD',
  REFUND: 'REFUND',
  REFERRAL: 'REFERRAL',
  PROMOTION: 'PROMOTION',
  BOOKING_REDEMPTION: 'BOOKING_REDEMPTION',
  ADMIN_ADJUSTMENT: 'ADMIN_ADJUSTMENT',
} as const;
export type CoinTransactionType = (typeof CoinTransactionType)[keyof typeof CoinTransactionType];

export const SupportTicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type SupportTicketStatus = (typeof SupportTicketStatus)[keyof typeof SupportTicketStatus];

export const SupportTicketCategory = {
  REFUND_ISSUE: 'REFUND_ISSUE',
  PAID_BUT_BOOKING_FAILED: 'PAID_BUT_BOOKING_FAILED',
  BOOKING_ISSUE: 'BOOKING_ISSUE',
  ACCOUNT_PROFILE_ISSUE: 'ACCOUNT_PROFILE_ISSUE',
  OTHER: 'OTHER',
} as const;
export type SupportTicketCategory =
  (typeof SupportTicketCategory)[keyof typeof SupportTicketCategory];

export const VenueStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type VenueStatus = (typeof VenueStatus)[keyof typeof VenueStatus];

export const PromotionScope = {
  PLATFORM: 'PLATFORM',
  OWNER: 'OWNER',
} as const;
export type PromotionScope = (typeof PromotionScope)[keyof typeof PromotionScope];

export const PromotionApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  DISABLED: 'DISABLED',
} as const;
export type PromotionApprovalStatus =
  (typeof PromotionApprovalStatus)[keyof typeof PromotionApprovalStatus];

export const TimeWindow = {
  ALL: 'ALL', // 0 AM - 12 AM (24 hours)
  LATE_NIGHT: 'LATE_NIGHT', // 12 AM - 6 AM
  MORNING: 'MORNING', // 6 AM - 12 PM
  AFTERNOON: 'AFTERNOON', // 12 PM - 6 PM
  EVENING: 'EVENING', // 6 PM - 12 AM
} as const;
export type TimeWindow = (typeof TimeWindow)[keyof typeof TimeWindow];

export const TIME_WINDOW_HOURS: Record<TimeWindow, { startHour: number; endHour: number }> = {
  ALL: { startHour: 0, endHour: 24 },
  LATE_NIGHT: { startHour: 0, endHour: 6 },
  MORNING: { startHour: 6, endHour: 12 },
  AFTERNOON: { startHour: 12, endHour: 18 },
  EVENING: { startHour: 18, endHour: 24 },
};
