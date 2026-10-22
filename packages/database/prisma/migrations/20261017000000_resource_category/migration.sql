-- The facility (VenueCategory) moves from the venue to each bookable unit, so
-- one venue can offer a football turf AND a swimming pool. A venue's
-- facilities are now derived from its units.
--
-- Each existing resource / resource group inherits its venue's current
-- category, so nothing changes for existing venues. venues.categoryId stays
-- (now nullable and deprecated) and is dropped in a later migration.
-- Nothing on resource_locks / inventory_reservations is touched.

-- 1. resources.categoryId
ALTER TABLE "resources" ADD COLUMN "categoryId" UUID;

UPDATE "resources" r
   SET "categoryId" = v."categoryId"
  FROM "venues" v
 WHERE r."venueId" = v."id" AND r."categoryId" IS NULL;

-- 2. resource_groups.categoryId
ALTER TABLE "resource_groups" ADD COLUMN "categoryId" UUID;

UPDATE "resource_groups" g
   SET "categoryId" = v."categoryId"
  FROM "venues" v
 WHERE g."venueId" = v."id" AND g."categoryId" IS NULL;

-- 3. Verify, then enforce
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "resources" WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'resources.categoryId backfill left NULL rows; aborting before SET NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM "resource_groups" WHERE "categoryId" IS NULL) THEN
    RAISE EXCEPTION 'resource_groups.categoryId backfill left NULL rows; aborting before SET NOT NULL';
  END IF;
END $$;

ALTER TABLE "resources" ALTER COLUMN "categoryId" SET NOT NULL;
ALTER TABLE "resource_groups" ALTER COLUMN "categoryId" SET NOT NULL;

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resource_groups"
  ADD CONSTRAINT "resource_groups_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "venue_categories"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "resources_categoryId_idx" ON "resources"("categoryId");
CREATE INDEX "resource_groups_categoryId_idx" ON "resource_groups"("categoryId");

-- 4. Venues no longer carry a category
ALTER TABLE "venues" ALTER COLUMN "categoryId" DROP NOT NULL;
