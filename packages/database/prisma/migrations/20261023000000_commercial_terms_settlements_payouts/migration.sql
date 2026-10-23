-- Commercial terms (commission, monthly cap, minimum advance, cancellation
-- windows, payout schedule) per facility, booking settlements and weekly
-- owner payouts. Hand-written: `prisma migrate diff` also proposes dropping
-- resource_locks.during / inventory_reservations.during, which back the
-- no-double-booking exclusion constraints (DEPLOYMENT.md) and must stay.

CREATE TYPE "CommercialPolicyScope" AS ENUM ('PLATFORM_DEFAULT', 'FACILITY', 'VENUE_FACILITY');
CREATE TYPE "SettlementKind" AS ENUM ('PLAYED', 'NO_SHOW', 'LATE_CANCEL');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PAID');

ALTER TABLE "bookings" ADD COLUMN "commercialTerms" JSONB;

CREATE TABLE "commercial_policies" (
    "id" UUID NOT NULL,
    "scope" "CommercialPolicyScope" NOT NULL,
    "categoryId" UUID,
    "venueId" UUID,
    "terms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "commercial_policies_pkey" PRIMARY KEY ("id"),
    -- Each scope names exactly its own target.
    CONSTRAINT "commercial_policies_scope_target_check" CHECK (
      ("scope" = 'PLATFORM_DEFAULT' AND "categoryId" IS NULL AND "venueId" IS NULL) OR
      ("scope" = 'FACILITY' AND "categoryId" IS NOT NULL AND "venueId" IS NULL) OR
      ("scope" = 'VENUE_FACILITY' AND "categoryId" IS NOT NULL AND "venueId" IS NOT NULL)
    )
);
CREATE INDEX "commercial_policies_categoryId_idx" ON "commercial_policies"("categoryId");
CREATE INDEX "commercial_policies_venueId_idx" ON "commercial_policies"("venueId");
-- One row per level target.
CREATE UNIQUE INDEX "commercial_policies_platform_default_key" ON "commercial_policies"("scope") WHERE "scope" = 'PLATFORM_DEFAULT';
CREATE UNIQUE INDEX "commercial_policies_facility_key" ON "commercial_policies"("categoryId") WHERE "scope" = 'FACILITY';
CREATE UNIQUE INDEX "commercial_policies_venue_facility_key" ON "commercial_policies"("venueId", "categoryId") WHERE "scope" = 'VENUE_FACILITY';
ALTER TABLE "commercial_policies" ADD CONSTRAINT "commercial_policies_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commercial_policies" ADD CONSTRAINT "commercial_policies_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "totalOwnerAmount" DECIMAL(12,2) NOT NULL,
    "settlementCount" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payouts_status_periodEnd_idx" ON "payouts"("status", "periodEnd");
CREATE UNIQUE INDEX "payouts_organizationId_periodEnd_currency_key" ON "payouts"("organizationId", "periodEnd", "currency");
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "booking_settlements" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "kind" "SettlementKind" NOT NULL,
    "slotStart" TIMESTAMP(3) NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "collected" DECIMAL(12,2) NOT NULL,
    "commission" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "refunded" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ownerAmount" DECIMAL(12,2) NOT NULL,
    "platformAmount" DECIMAL(12,2) NOT NULL,
    "details" JSONB NOT NULL,
    "payoutId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "booking_settlements_pkey" PRIMARY KEY ("id"),
    -- The split always adds up to what was collected.
    CONSTRAINT "booking_settlements_split_check" CHECK (
      "ownerAmount" >= 0 AND "platformAmount" >= 0 AND "refunded" >= 0 AND
      "ownerAmount" + "platformAmount" + "refunded" = "collected"
    )
);
CREATE UNIQUE INDEX "booking_settlements_bookingId_key" ON "booking_settlements"("bookingId");
CREATE INDEX "booking_settlements_organizationId_payoutId_idx" ON "booking_settlements"("organizationId", "payoutId");
CREATE INDEX "booking_settlements_venueId_categoryId_periodMonth_idx" ON "booking_settlements"("venueId", "categoryId", "periodMonth");
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_settlements" ADD CONSTRAINT "booking_settlements_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "venue_commission_months" (
    "venueId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "bookingCount" INTEGER NOT NULL DEFAULT 0,
    "commissionTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "venue_commission_months_pkey" PRIMARY KEY ("venueId","categoryId","periodMonth")
);

-- Starting values (docs: founder/pricing-strategy.md). All editable in the
-- admin portal afterwards. The platform default pre-fills new facilities.
INSERT INTO "commercial_policies" ("id", "scope", "terms", "updatedAt") VALUES (
  gen_random_uuid(), 'PLATFORM_DEFAULT',
  '{"commissionTiers":[{"fromBooking":1,"type":"PERCENTAGE","value":10}],"monthlyCommissionCap":2500,"afterCapFeePercent":2.5,"minAdvancePercent":25,"cancellationTiers":[{"minHoursBeforeStart":6,"refundPercent":100,"ownerPercent":0},{"minHoursBeforeStart":1,"refundPercent":30,"ownerPercent":50}],"cancelCutoffMinutes":60,"payoutWeekday":1,"payoutTimezone":"Asia/Kolkata"}',
  CURRENT_TIMESTAMP
);

-- Every existing facility gets its own full copy (experiences and
-- room/table facilities start from their own rate card).
INSERT INTO "commercial_policies" ("id", "scope", "categoryId", "terms", "updatedAt")
SELECT gen_random_uuid(), 'FACILITY', c."id",
  CASE
    WHEN c."slug" = 'KAYAKING' THEN
      '{"commissionTiers":[{"fromBooking":1,"type":"PERCENTAGE","value":18}],"monthlyCommissionCap":null,"afterCapFeePercent":0,"minAdvancePercent":50,"cancellationTiers":[{"minHoursBeforeStart":24,"refundPercent":100,"ownerPercent":0},{"minHoursBeforeStart":3,"refundPercent":30,"ownerPercent":50}],"cancelCutoffMinutes":180}'::jsonb
    WHEN c."slug" IN ('BILLIARDS', 'SNOOKER', 'GAMING_STATION', 'PHOTO_STUDIO', 'STUDIO') THEN
      '{"commissionTiers":[{"fromBooking":1,"type":"PERCENTAGE","value":10}],"monthlyCommissionCap":2000,"afterCapFeePercent":2.5,"minAdvancePercent":25,"cancellationTiers":[{"minHoursBeforeStart":6,"refundPercent":100,"ownerPercent":0},{"minHoursBeforeStart":1,"refundPercent":30,"ownerPercent":50}],"cancelCutoffMinutes":60}'::jsonb
    ELSE
      '{"commissionTiers":[{"fromBooking":1,"type":"PERCENTAGE","value":10}],"monthlyCommissionCap":2500,"afterCapFeePercent":2.5,"minAdvancePercent":25,"cancellationTiers":[{"minHoursBeforeStart":6,"refundPercent":100,"ownerPercent":0},{"minHoursBeforeStart":1,"refundPercent":30,"ownerPercent":50}],"cancelCutoffMinutes":60}'::jsonb
  END,
  CURRENT_TIMESTAMP
FROM "venue_categories" c;
