-- Pooled groups (e.g. kayak fleets): whether customers can book them, and fixed departure times versus any start time.
CREATE TYPE "GroupSlotMode" AS ENUM ('FLEXIBLE', 'FIXED');

ALTER TABLE "resource_groups"
  ADD COLUMN "isBookable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "slotMode" "GroupSlotMode" NOT NULL DEFAULT 'FLEXIBLE',
  ADD COLUMN "fixedStartTimes" TEXT[] DEFAULT ARRAY[]::TEXT[];
