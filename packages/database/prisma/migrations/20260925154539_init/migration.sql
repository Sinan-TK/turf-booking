-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AdminUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OwnerOrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OwnerUserRole" AS ENUM ('OWNER_ADMIN', 'OWNER_STAFF');

-- CreateEnum
CREATE TYPE "OwnerUserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CustomerSessionSourceLinkType" AS ENUM ('BOOKING', 'MY_BOOKINGS', 'PROFILE');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TurfStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('WEEKDAY', 'WEEKEND', 'HOLIDAY');

-- CreateEnum
CREATE TYPE "BookingSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingSessionSource" AS ENUM ('WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "SlotHoldStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "BookingCancellationReasonCode" AS ENUM ('CUSTOMER_REQUESTED', 'HOLD_EXPIRED', 'RESOURCE_REALLOCATED', 'ADMIN_ACTION', 'OWNER_ACTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MONEY', 'COINS');

-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('RAZORPAY', 'COINS');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CoinTransactionType" AS ENUM ('BOOKING_REWARD', 'REFUND', 'REFERRAL', 'PROMOTION', 'BOOKING_REDEMPTION', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CancellationPolicyScope" AS ENUM ('PLATFORM_DEFAULT', 'TURF');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('PLATFORM_DEFAULT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "PromotionScope" AS ENUM ('PLATFORM', 'OWNER');

-- CreateEnum
CREATE TYPE "PromotionApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PromotionDiscountType" AS ENUM ('PERCENTAGE', 'FLAT');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('REFUND_ISSUE', 'PAID_BUT_BOOKING_FAILED', 'BOOKING_ISSUE', 'ACCOUNT_PROFILE_ISSUE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportMessageAuthorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookGateway" AS ENUM ('RAZORPAY', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('CUSTOMER', 'OWNER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPER_ADMIN',
    "status" "AdminUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "OwnerOrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turf_owner_users" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "OwnerUserRole" NOT NULL DEFAULT 'OWNER_STAFF',
    "status" "OwnerUserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turf_owner_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "profilePhotoUrl" TEXT,
    "defaultLat" DECIMAL(9,6),
    "defaultLng" DECIMAL(9,6),
    "defaultAreaId" UUID,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "sourceLinkType" "CustomerSessionSourceLinkType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isoCode" CHAR(2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "states" (
    "id" UUID NOT NULL,
    "countryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "districts" (
    "id" UUID NOT NULL,
    "stateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_code_sequences" (
    "districtId" UUID NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 10000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facility_code_sequences_pkey" PRIMARY KEY ("districtId")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "districtId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turfs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "districtId" UUID NOT NULL,
    "areaId" UUID,
    "address" TEXT NOT NULL,
    "lat" DECIMAL(9,6) NOT NULL,
    "lng" DECIMAL(9,6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "TurfStatus" NOT NULL DEFAULT 'DRAFT',
    "cancellationPolicyId" UUID,
    "defaultSlotGranularityMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "turfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operating_hours" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,

    CONSTRAINT "operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turf_photos" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turf_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turf_facility_tags" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "turf_facility_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_dates" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "resourceId" UUID,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "createdByOwnerUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "groundType" TEXT NOT NULL,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "status" "ResourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_compositions" (
    "id" UUID NOT NULL,
    "parentResourceId" UUID NOT NULL,
    "childResourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_compositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_closures" (
    "id" UUID NOT NULL,
    "ancestorId" UUID NOT NULL,
    "descendantId" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "resource_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "dayType" "DayType" NOT NULL,
    "startWindow" TEXT,
    "endWindow" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "BookingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "BookingSessionSource" NOT NULL,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_holds" (
    "id" UUID NOT NULL,
    "bookingSessionId" UUID,
    "resourceId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "status" "SlotHoldStatus" NOT NULL DEFAULT 'HELD',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slot_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_locks" (
    "id" UUID NOT NULL,
    "slotHoldId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "status" "SlotHoldStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "orderSeq" BIGSERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "slotHoldId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "groundType" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "paymentMethod" "PaymentMethod",
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "cancellationReasonCode" "BookingCancellationReasonCode",
    "cancellationNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "provider" "PaymentProviderType" NOT NULL,
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "failureReason" TEXT,
    "rawResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "paymentId" UUID,
    "originalAmount" DECIMAL(12,2) NOT NULL,
    "originalCurrency" CHAR(3) NOT NULL DEFAULT 'INR',
    "coinAmountCredited" DECIMAL(12,2) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "policySnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_wallets" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "cachedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coin_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coin_transactions" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "type" "CoinTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "bookingId" UUID,
    "refundId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coin_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" UUID NOT NULL,
    "scope" "CancellationPolicyScope" NOT NULL,
    "tiers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "organizationId" UUID,
    "type" "CommissionType" NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "scope" "PromotionScope" NOT NULL,
    "organizationId" UUID,
    "code" TEXT,
    "discountType" "PromotionDiscountType" NOT NULL,
    "discountValue" DECIMAL(12,2) NOT NULL,
    "constraints" JSONB NOT NULL,
    "approvalStatus" "PromotionApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdByOwnerUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "promotionId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "discountApplied" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_turfs" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_turfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "bookingId" UUID,
    "turfId" UUID,
    "category" "SupportTicketCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorType" "SupportMessageAuthorType" NOT NULL,
    "authorAdminId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "gateway" "WebhookGateway" NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorAdminId" UUID,
    "actorOwnerUserId" UUID,
    "actorCustomerId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "turf_owner_users_email_key" ON "turf_owner_users"("email");

-- CreateIndex
CREATE INDEX "turf_owner_users_organizationId_idx" ON "turf_owner_users"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_whatsappNumber_key" ON "customer_profiles"("whatsappNumber");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_email_key" ON "customer_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_sessionTokenHash_key" ON "customer_sessions"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "customer_sessions_customerId_idx" ON "customer_sessions"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "countries_isoCode_key" ON "countries"("isoCode");

-- CreateIndex
CREATE UNIQUE INDEX "states_countryId_code_key" ON "states"("countryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "states_countryId_name_key" ON "states"("countryId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "districts_stateId_code_key" ON "districts"("stateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "districts_stateId_name_key" ON "districts"("stateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "areas_districtId_name_key" ON "areas"("districtId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "turfs_facilityCode_key" ON "turfs"("facilityCode");

-- CreateIndex
CREATE UNIQUE INDEX "turfs_cancellationPolicyId_key" ON "turfs"("cancellationPolicyId");

-- CreateIndex
CREATE INDEX "turfs_organizationId_idx" ON "turfs"("organizationId");

-- CreateIndex
CREATE INDEX "turfs_districtId_idx" ON "turfs"("districtId");

-- CreateIndex
CREATE INDEX "turfs_lat_lng_idx" ON "turfs"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "operating_hours_turfId_weekday_key" ON "operating_hours"("turfId", "weekday");

-- CreateIndex
CREATE INDEX "turf_photos_turfId_idx" ON "turf_photos"("turfId");

-- CreateIndex
CREATE UNIQUE INDEX "turf_facility_tags_turfId_tag_key" ON "turf_facility_tags"("turfId", "tag");

-- CreateIndex
CREATE INDEX "blocked_dates_turfId_startTime_idx" ON "blocked_dates"("turfId", "startTime");

-- CreateIndex
CREATE INDEX "blocked_dates_resourceId_startTime_idx" ON "blocked_dates"("resourceId", "startTime");

-- CreateIndex
CREATE INDEX "resources_turfId_idx" ON "resources"("turfId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_compositions_parentResourceId_childResourceId_key" ON "resource_compositions"("parentResourceId", "childResourceId");

-- CreateIndex
CREATE INDEX "resource_closures_descendantId_idx" ON "resource_closures"("descendantId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_closures_ancestorId_descendantId_key" ON "resource_closures"("ancestorId", "descendantId");

-- CreateIndex
CREATE INDEX "pricing_rules_resourceId_durationMinutes_dayType_idx" ON "pricing_rules"("resourceId", "durationMinutes", "dayType");

-- CreateIndex
CREATE UNIQUE INDEX "booking_sessions_tokenHash_key" ON "booking_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "booking_sessions_customerId_status_idx" ON "booking_sessions"("customerId", "status");

-- CreateIndex
CREATE INDEX "slot_holds_resourceId_startTime_idx" ON "slot_holds"("resourceId", "startTime");

-- CreateIndex
CREATE INDEX "slot_holds_customerId_status_idx" ON "slot_holds"("customerId", "status");

-- CreateIndex
CREATE INDEX "slot_holds_status_holdExpiresAt_idx" ON "slot_holds"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "resource_locks_resourceId_status_idx" ON "resource_locks"("resourceId", "status");

-- CreateIndex
CREATE INDEX "resource_locks_slotHoldId_idx" ON "resource_locks"("slotHoldId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_orderSeq_key" ON "bookings"("orderSeq");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_orderId_key" ON "bookings"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_slotHoldId_key" ON "bookings"("slotHoldId");

-- CreateIndex
CREATE INDEX "bookings_customerId_status_idx" ON "bookings"("customerId", "status");

-- CreateIndex
CREATE INDEX "bookings_turfId_status_idx" ON "bookings"("turfId", "status");

-- CreateIndex
CREATE INDEX "bookings_resourceId_startTime_idx" ON "bookings"("resourceId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayOrderId_key" ON "payments"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_gatewayPaymentId_key" ON "payments"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX "refunds_bookingId_idx" ON "refunds"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "coin_wallets_customerId_key" ON "coin_wallets"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "coin_transactions_idempotencyKey_key" ON "coin_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "coin_transactions_walletId_createdAt_idx" ON "coin_transactions"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "coin_transactions_customerId_createdAt_idx" ON "coin_transactions"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "commissions_organizationId_effectiveFrom_idx" ON "commissions"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotions_organizationId_idx" ON "promotions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_bookingId_key" ON "promotion_redemptions"("bookingId");

-- CreateIndex
CREATE INDEX "promotion_redemptions_promotionId_idx" ON "promotion_redemptions"("promotionId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_turfs_customerId_turfId_key" ON "saved_turfs"("customerId", "turfId");

-- CreateIndex
CREATE INDEX "support_tickets_customerId_status_idx" ON "support_tickets"("customerId", "status");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_idx" ON "support_messages"("ticketId");

-- CreateIndex
CREATE INDEX "notifications_customerId_status_idx" ON "notifications"("customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_gateway_eventId_key" ON "webhook_events"("gateway", "eventId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_createdAt_idx" ON "audit_logs"("actorType", "createdAt");

-- AddForeignKey
ALTER TABLE "turf_owner_users" ADD CONSTRAINT "turf_owner_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_defaultAreaId_fkey" FOREIGN KEY ("defaultAreaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "states" ADD CONSTRAINT "states_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "districts" ADD CONSTRAINT "districts_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_code_sequences" ADD CONSTRAINT "facility_code_sequences_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turfs" ADD CONSTRAINT "turfs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turfs" ADD CONSTRAINT "turfs_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turfs" ADD CONSTRAINT "turfs_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turfs" ADD CONSTRAINT "turfs_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turf_photos" ADD CONSTRAINT "turf_photos_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turf_facility_tags" ADD CONSTRAINT "turf_facility_tags_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_dates" ADD CONSTRAINT "blocked_dates_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_dates" ADD CONSTRAINT "blocked_dates_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_dates" ADD CONSTRAINT "blocked_dates_createdByOwnerUserId_fkey" FOREIGN KEY ("createdByOwnerUserId") REFERENCES "turf_owner_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_compositions" ADD CONSTRAINT "resource_compositions_parentResourceId_fkey" FOREIGN KEY ("parentResourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_compositions" ADD CONSTRAINT "resource_compositions_childResourceId_fkey" FOREIGN KEY ("childResourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_closures" ADD CONSTRAINT "resource_closures_ancestorId_fkey" FOREIGN KEY ("ancestorId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_closures" ADD CONSTRAINT "resource_closures_descendantId_fkey" FOREIGN KEY ("descendantId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_sessions" ADD CONSTRAINT "booking_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_bookingSessionId_fkey" FOREIGN KEY ("bookingSessionId") REFERENCES "booking_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_locks" ADD CONSTRAINT "resource_locks_slotHoldId_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "slot_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_locks" ADD CONSTRAINT "resource_locks_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_slotHoldId_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "slot_holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_wallets" ADD CONSTRAINT "coin_wallets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "coin_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_createdByOwnerUserId_fkey" FOREIGN KEY ("createdByOwnerUserId") REFERENCES "turf_owner_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_turfs" ADD CONSTRAINT "saved_turfs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_turfs" ADD CONSTRAINT "saved_turfs_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorOwnerUserId_fkey" FOREIGN KEY ("actorOwnerUserId") REFERENCES "turf_owner_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
-- Anti-double-booking guarantee (ARCHITECTURE.md §6.3)
--
-- Prisma's schema DSL has no native syntax for Postgres EXCLUDE
-- constraints or range types, so this block is hand-written rather than
-- generated. It is the single mechanism that makes double-booking
-- structurally impossible: two concurrent transactions inserting
-- overlapping ResourceLock rows for the same resource_id (whether from
-- the same booking attempt or from a parent/child resource in the same
-- composition closure) cannot both commit — Postgres itself rejects the
-- second insert. Verified against a live Postgres instance — see
-- ARCHITECTURE.md §6.3 for the concurrent-transaction test and its
-- result (exclusion_violation / deadlock_detected, both must be handled
-- by the application as "slot no longer available").
-- =====================================================================

ALTER TABLE "resource_locks"
  ADD COLUMN "during" tstzrange
  GENERATED ALWAYS AS (tstzrange("startTime", "endTime", '[)')) STORED;

ALTER TABLE "resource_locks"
  ADD CONSTRAINT "no_overlapping_resource_locks"
  EXCLUDE USING gist (
    "resourceId" WITH =,
    "during" WITH &&
  )
  WHERE ("status" IN ('HELD', 'CONFIRMED'));
