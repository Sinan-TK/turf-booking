-- Turf -> Venue rename. RENAMES ONLY: no table, column or enum value is
-- dropped, recreated or rewritten, so every row (bookings, payments, refunds,
-- coin ledger, resource_locks) is untouched. resource_locks, its generated
-- "during" column and the no_overlapping_resource_locks exclusion constraint
-- are not referenced by anything below.

-- Tables
ALTER TABLE "turfs" RENAME TO "venues";
ALTER TABLE "turf_photos" RENAME TO "venue_photos";
ALTER TABLE "turf_facility_tags" RENAME TO "venue_facility_tags";
ALTER TABLE "turf_owner_users" RENAME TO "venue_owner_users";
ALTER TABLE "saved_turfs" RENAME TO "saved_venues";

-- Columns ("turfId" -> "venueId")
ALTER TABLE "availability_rules" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "blocked_dates" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "blocked_periods" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "booking_policies" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "bookings" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "operating_hours" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "resource_groups" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "resources" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "saved_venues" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "support_tickets" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "venue_facility_tags" RENAME COLUMN "turfId" TO "venueId";
ALTER TABLE "venue_photos" RENAME COLUMN "turfId" TO "venueId";

-- Enum type and values
ALTER TYPE "TurfStatus" RENAME TO "VenueStatus";
ALTER TYPE "BookingPolicyScope" RENAME VALUE 'TURF' TO 'VENUE';
ALTER TYPE "CancellationPolicyScope" RENAME VALUE 'TURF' TO 'VENUE';

-- Constraint and index names, so they match what Prisma derives from the new
-- table/column names (keeps `prisma migrate dev` from proposing churn).
-- Primary keys / unique / foreign keys first (renaming a constraint also
-- renames its backing index), then any standalone index.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conrelid::regclass::text AS tbl, conname
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND contype IN ('p', 'u', 'f')
      AND conname LIKE '%turf%'
  LOOP
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
      r.tbl, r.conname, replace(r.conname, 'turf', 'venue'));
  END LOOP;

  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname LIKE '%turf%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',
      r.indexname, replace(r.indexname, 'turf', 'venue'));
  END LOOP;
END $$;
