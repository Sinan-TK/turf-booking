-- Venue categories become first-class: Turf.categoryId + category display
-- metadata. ADDITIVE ONLY — no DROP / TRUNCATE / DELETE; nothing on
-- resource_locks or inventory_reservations (the `during` columns and the
-- no_overlapping_resource_locks GiST constraint are untouched).
--
-- The only row updates are (a) setting the new turfs.categoryId column and
-- (b) filling the new display columns on the FOOTBALL_TURF category row.
-- No booking, payment, refund or coin row is read or written.

-- 1. Category display metadata (all with defaults -> safe on existing rows)
ALTER TABLE "venue_categories"
  ADD COLUMN "iconKey"    TEXT    NOT NULL DEFAULT 'category',
  ADD COLUMN "unitLabel"  TEXT    NOT NULL DEFAULT 'Unit',
  ADD COLUMN "venueLabel" TEXT    NOT NULL DEFAULT 'Venue',
  ADD COLUMN "unitTypes"  TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sortOrder"  INTEGER NOT NULL DEFAULT 0;

-- 2. FOOTBALL_TURF must exist for the backfill below (the P1 seed normally
--    created it; this makes the migration self-sufficient). Existing rows
--    keep their name/mode/active flag; only the new display columns are set.
INSERT INTO "venue_categories"
  ("id", "slug", "name", "defaultAllocationMode", "isActive",
   "iconKey", "unitLabel", "venueLabel", "unitTypes", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'FOOTBALL_TURF', 'Football Turf', 'EXCLUSIVE', true,
   'sports_soccer', 'Pitch', 'Turf', ARRAY['5S','7S']::TEXT[], 0, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "iconKey"    = 'sports_soccer',
  "unitLabel"  = 'Pitch',
  "venueLabel" = 'Turf',
  "unitTypes"  = ARRAY['5S','7S']::TEXT[],
  "sortOrder"  = 0;

-- 3. Turf.categoryId: add nullable, backfill every existing turf to
--    FOOTBALL_TURF, verify nothing is left NULL, then enforce NOT NULL.
ALTER TABLE "turfs" ADD COLUMN "categoryId" UUID;

UPDATE "turfs"
   SET "categoryId" = (SELECT "id" FROM "venue_categories" WHERE "slug" = 'FOOTBALL_TURF')
 WHERE "categoryId" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "turfs" WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'turfs.categoryId backfill left NULL rows; aborting before SET NOT NULL';
  END IF;
END $$;

ALTER TABLE "turfs" ALTER COLUMN "categoryId" SET NOT NULL;

ALTER TABLE "turfs"
  ADD CONSTRAINT "turfs_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "turfs_categoryId_idx" ON "turfs"("categoryId");
