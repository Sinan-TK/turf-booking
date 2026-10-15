-- P1: Universal hourly-venue domain skeleton (ADDITIVE ONLY).
--
-- Creates: enums AllocationMode, BookingPolicyScope; tables
-- venue_categories, resource_groups, booking_policies,
-- availability_rules, blocked_periods (+ indexes + FKs to EXISTING
-- tables). Enables RLS on the new tables to match the repo's
-- deny-by-default posture (Prisma superuser bypasses RLS).
--
-- Contains NO DROP, RENAME, DELETE, TRUNCATE, or destructive ALTER.
-- Untouched: resource_locks (incl. the `during` generated column and
-- the no_overlapping_resource_locks GiST exclusion constraint),
-- bookings, payments, refunds, coin_wallets, coin_transactions,
-- booking_order_seq, facility_code_sequences, and every existing
-- table, index, FK, and record.
--
-- NOTE (established repo pattern): `prisma migrate diff` cannot render
-- resource_locks.during (raw-SQL generated column backing the
-- anti-double-booking exclusion constraint). This migration was
-- assembled from Prisma's own offline renderer
-- (`migrate diff --from-empty`, new-object statements only) plus the
-- hand-written RLS block below, without any database connection, so
-- there was no `DROP COLUMN "during"` proposal to strip. Future
-- migrations touching resource_locks must still strip that line by
-- hand before applying.

-- CreateEnum
CREATE TYPE "AllocationMode" AS ENUM ('EXCLUSIVE', 'POOLED');

-- CreateEnum
CREATE TYPE "BookingPolicyScope" AS ENUM ('PLATFORM_DEFAULT', 'CATEGORY', 'TURF', 'GROUP', 'RESOURCE');

-- CreateTable
CREATE TABLE "venue_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultAllocationMode" "AllocationMode" NOT NULL,
    "attributesSchema" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_groups" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "allocationMode" "AllocationMode" NOT NULL,
    "totalUnits" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_policies" (
    "id" UUID NOT NULL,
    "scope" "BookingPolicyScope" NOT NULL,
    "categoryId" UUID,
    "turfId" UUID,
    "resourceGroupId" UUID,
    "resourceId" UUID,
    "slotIntervalMin" INTEGER NOT NULL,
    "minDurationMin" INTEGER NOT NULL,
    "maxDurationMin" INTEGER NOT NULL,
    "durationIncrementMin" INTEGER NOT NULL,
    "bufferBeforeMin" INTEGER NOT NULL DEFAULT 0,
    "bufferAfterMin" INTEGER NOT NULL DEFAULT 0,
    "maxAdvanceDays" INTEGER NOT NULL,
    "minLeadMinutes" INTEGER NOT NULL,
    "cancellationPolicyId" UUID,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "resourceId" UUID,
    "resourceGroupId" UUID,
    "weekday" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "sourceOperatingHoursId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_periods" (
    "id" UUID NOT NULL,
    "turfId" UUID NOT NULL,
    "resourceId" UUID,
    "resourceGroupId" UUID,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "createdByOwnerUserId" UUID,
    "sourceBlockedDateId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_categories_slug_key" ON "venue_categories"("slug");

-- CreateIndex
CREATE INDEX "resource_groups_turfId_idx" ON "resource_groups"("turfId");

-- CreateIndex
CREATE INDEX "booking_policies_scope_effectiveFrom_idx" ON "booking_policies"("scope", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "availability_rules_sourceOperatingHoursId_key" ON "availability_rules"("sourceOperatingHoursId");

-- CreateIndex
CREATE INDEX "availability_rules_turfId_weekday_idx" ON "availability_rules"("turfId", "weekday");

-- CreateIndex
CREATE INDEX "availability_rules_resourceId_weekday_idx" ON "availability_rules"("resourceId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_periods_sourceBlockedDateId_key" ON "blocked_periods"("sourceBlockedDateId");

-- CreateIndex
CREATE INDEX "blocked_periods_turfId_startTime_idx" ON "blocked_periods"("turfId", "startTime");

-- CreateIndex
CREATE INDEX "blocked_periods_resourceId_startTime_idx" ON "blocked_periods"("resourceId", "startTime");

-- AddForeignKey
ALTER TABLE "resource_groups" ADD CONSTRAINT "resource_groups_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_turfId_fkey" FOREIGN KEY ("turfId") REFERENCES "turfs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_periods" ADD CONSTRAINT "blocked_periods_createdByOwnerUserId_fkey" FOREIGN KEY ("createdByOwnerUserId") REFERENCES "turf_owner_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: match the repo's deny-by-default RLS posture
-- (20260927200100_enable_rls_all_tables). Prisma connects as superuser
-- and bypasses RLS; no policies = no behavior change for the app.
ALTER TABLE "venue_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "availability_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "blocked_periods" ENABLE ROW LEVEL SECURITY;
