-- P2: Pooled quantity inventory (kayak fleets) — ADDITIVE ONLY.
--
-- Creates: enum PricingMode; table inventory_reservations (+ indexes +
-- FKs + `during` generated column + plain GiST index + RLS).
-- Relaxes (no data change — all existing rows already satisfy the new
-- shape): slot_holds.resourceId, bookings.resourceId,
-- pricing_rules.resourceId DROP NOT NULL; adds resourceGroupId,
-- quantity (DEFAULT 1), pricingMode (DEFAULT PER_BOOKING) columns.
--
-- Contains NO DROP COLUMN/TABLE, RENAME, DELETE, TRUNCATE, or other
-- destructive operation. Untouched: resource_locks (incl. its `during`
-- column and the no_overlapping_resource_locks exclusion constraint),
-- booking_order_seq, facility_code_sequences, and every existing row.
--
-- NOTE (established repo pattern, now covering TWO tables):
-- `inventory_reservations.during` — like `resource_locks.during` — is a
-- raw-SQL generated column Prisma cannot render, so future
-- `migrate diff` output touching either table must have any proposed
-- `DROP COLUMN "during"` stripped by hand before applying. The GiST
-- index on inventory_reservations.during is a PLAIN range index for the
-- overlap lookup, deliberately NOT an exclusion constraint: exclusion
-- is binary occupancy and cannot express counted quantity inventory.

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('PER_BOOKING', 'PER_UNIT');

-- CreateTable
CREATE TABLE "inventory_reservations" (
    "id" UUID NOT NULL,
    "slotHoldId" UUID NOT NULL,
    "resourceGroupId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "startTime" TIMESTAMPTZ NOT NULL,
    "endTime" TIMESTAMPTZ NOT NULL,
    "status" "SlotHoldStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_reservations_resourceGroupId_status_idx" ON "inventory_reservations"("resourceGroupId", "status");

-- CreateIndex
CREATE INDEX "inventory_reservations_slotHoldId_idx" ON "inventory_reservations"("slotHoldId");

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_slotHoldId_fkey" FOREIGN KEY ("slotHoldId") REFERENCES "slot_holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: overlap-search support for the pooled capacity check
-- (same generated-column shape as resource_locks.during, plain index).
ALTER TABLE "inventory_reservations" ADD COLUMN "during" tstzrange
  GENERATED ALWAYS AS (tstzrange("startTime", "endTime", '[)')) STORED;
CREATE INDEX "inventory_reservations_group_during_idx" ON "inventory_reservations" USING gist ("resourceGroupId", "during");

-- Hand-written: match the repo's deny-by-default RLS posture
-- (20260927200100_enable_rls_all_tables). Prisma connects as superuser
-- and bypasses RLS; no policies = no behavior change for the app.
ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;

-- Relax: a hold/booking now targets exactly one of Resource /
-- ResourceGroup (service-layer rule); legacy rows are all resourceId
-- with quantity 1, so DROP NOT NULL changes no data.
ALTER TABLE "slot_holds" ALTER COLUMN "resourceId" DROP NOT NULL;
ALTER TABLE "slot_holds" ADD COLUMN "resourceGroupId" UUID;
ALTER TABLE "slot_holds" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relax: same rule for the booking header (turfId stays required — the
-- venue scope never moves to the resource/group level).
ALTER TABLE "bookings" ALTER COLUMN "resourceId" DROP NOT NULL;
ALTER TABLE "bookings" ADD COLUMN "resourceGroupId" UUID;
ALTER TABLE "bookings" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relax: a pricing rule prices either one Resource or one pooled group;
-- legacy rows are all resource-scoped PER_BOOKING.
ALTER TABLE "pricing_rules" ALTER COLUMN "resourceId" DROP NOT NULL;
ALTER TABLE "pricing_rules" ADD COLUMN "resourceGroupId" UUID;
ALTER TABLE "pricing_rules" ADD COLUMN "pricingMode" "PricingMode" NOT NULL DEFAULT 'PER_BOOKING';
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pricing_rules_resourceGroupId_durationMinutes_dayType_idx" ON "pricing_rules"("resourceGroupId", "durationMinutes", "dayType");
