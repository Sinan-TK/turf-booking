-- Each unit (pitch, court, table...) now has its own shortest and longest booking, and its prices are per block of the
-- shortest length. A longer booking costs one block price per block.
ALTER TABLE "resources"
  ADD COLUMN "minDurationMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "maxDurationMinutes" INTEGER NOT NULL DEFAULT 180;

-- Minimum: the shortest duration the unit already has a price for; a unit without prices takes its policy's minimum
-- (unit, then venue, then facility, then platform default, else 60).
UPDATE "resources" r
SET "minDurationMinutes" = m.shortest
FROM (
  SELECT "resourceId", MIN("durationMinutes") AS shortest
  FROM "pricing_rules"
  WHERE "resourceId" IS NOT NULL
  GROUP BY "resourceId"
) m
WHERE m."resourceId" = r.id;

UPDATE "resources" r
SET "minDurationMinutes" = COALESCE(
  (SELECT bp."minDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'RESOURCE' AND bp."resourceId" = r.id AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
  (SELECT bp."minDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'VENUE' AND bp."venueId" = r."venueId" AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
  (SELECT bp."minDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'CATEGORY' AND bp."categoryId" = r."categoryId" AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
  (SELECT bp."minDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'PLATFORM_DEFAULT' AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
  60
)
WHERE NOT EXISTS (SELECT 1 FROM "pricing_rules" p WHERE p."resourceId" = r.id);

-- Maximum: the longest whole multiple of the minimum that the same policy chain allowed (never below the minimum).
UPDATE "resources" r
SET "maxDurationMinutes" = LEAST(
  1440,
  GREATEST(
    r."minDurationMinutes",
    (
      COALESCE(
        (SELECT bp."maxDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'RESOURCE' AND bp."resourceId" = r.id AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
        (SELECT bp."maxDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'VENUE' AND bp."venueId" = r."venueId" AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
        (SELECT bp."maxDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'CATEGORY' AND bp."categoryId" = r."categoryId" AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
        (SELECT bp."maxDurationMin" FROM "booking_policies" bp WHERE bp.scope = 'PLATFORM_DEFAULT' AND bp."effectiveFrom" <= now() ORDER BY bp."effectiveFrom" DESC LIMIT 1),
        180
      ) / r."minDurationMinutes"
    ) * r."minDurationMinutes"
  )
);

-- Prices for a longer duration than the unit's minimum are now covered by the block price, so they are switched off (kept,
-- not deleted: the owner can remove them from the prices list).
UPDATE "pricing_rules" p
SET "isActive" = false
FROM "resources" r
WHERE p."resourceId" = r.id AND p."durationMinutes" > r."minDurationMinutes";
