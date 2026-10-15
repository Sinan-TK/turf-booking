-- Owner notification center: a persistent, in-app read/unread feed for
-- Turf Owner logins (turf_owner_users), separate from the existing
-- `notifications` table (outbound customer delivery tracking — a
-- different shape/purpose entirely, left untouched by this migration).

CREATE TYPE "OwnerNotificationType" AS ENUM (
  'BOOKING_CREATED',
  'BOOKING_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKING_RESCHEDULED',
  'PAYMENT_RECEIVED',
  'PAYMENT_FAILED',
  'ADMIN_ANNOUNCEMENT',
  'ADMIN_WARNING',
  'SYSTEM'
);

CREATE TABLE "owner_notifications" (
  "id"        UUID NOT NULL,
  "ownerId"   UUID NOT NULL,
  "type"      "OwnerNotificationType" NOT NULL,
  "title"     TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "data"      JSONB,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owner_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_notifications_ownerId_createdAt_idx"
  ON "owner_notifications" ("ownerId", "createdAt");

CREATE INDEX "owner_notifications_ownerId_readAt_idx"
  ON "owner_notifications" ("ownerId", "readAt");

ALTER TABLE "owner_notifications"
  ADD CONSTRAINT "owner_notifications_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "turf_owner_users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
