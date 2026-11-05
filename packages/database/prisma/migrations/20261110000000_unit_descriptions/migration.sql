-- The description now belongs to each unit (a court, a turf, a pooled item) instead of the venue.
ALTER TABLE "resources" ADD COLUMN "description" TEXT;
ALTER TABLE "resource_groups" ADD COLUMN "description" TEXT;

-- What owners already wrote about their venue moves down to every unit of it, so no text is lost (they can then edit each one).
UPDATE "resources" r SET "description" = v."description" FROM "venues" v WHERE r."venueId" = v."id" AND v."description" IS NOT NULL AND btrim(v."description") <> '';
UPDATE "resource_groups" g SET "description" = v."description" FROM "venues" v WHERE g."venueId" = v."id" AND v."description" IS NOT NULL AND btrim(v."description") <> '';
