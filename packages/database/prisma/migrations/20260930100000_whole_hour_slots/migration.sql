-- Whole-hour-only booking slots: the platform now runs purely on 60-minute
-- slot granularity (Turf.defaultSlotGranularityMinutes is no longer
-- owner/admin configurable, see apps/api/src/turfs/dto/turf.dto.ts).
ALTER TABLE "turfs" ALTER COLUMN "defaultSlotGranularityMinutes" SET DEFAULT 60;

-- Bring any existing turf in line with the new fixed value. At the time of
-- writing this affects zero production PricingRule/Booking rows, so there is
-- no duration semantics to preserve.
UPDATE "turfs" SET "defaultSlotGranularityMinutes" = 60 WHERE "defaultSlotGranularityMinutes" != 60;
