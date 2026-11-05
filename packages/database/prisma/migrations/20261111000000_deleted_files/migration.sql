-- Files removed from the app that may still be in the bucket (no delete access on R2): listed for the admin to remove by hand.
CREATE TYPE "DeletedFileSource" AS ENUM ('UNIT_PHOTO', 'GROUP_PHOTO', 'BANNER', 'CATEGORY_IMAGE', 'OTHER');
CREATE TYPE "DeletedFileActor" AS ENUM ('OWNER', 'ADMIN', 'SYSTEM');

CREATE TABLE "deleted_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "source" "DeletedFileSource" NOT NULL DEFAULT 'OTHER',
  "label" TEXT,
  "venueId" UUID,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedByType" "DeletedFileActor" NOT NULL DEFAULT 'SYSTEM',
  "deletedById" TEXT,
  "removedAt" TIMESTAMP(3),
  "removedByAdminId" UUID,
  CONSTRAINT "deleted_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "deleted_files_key_key" ON "deleted_files"("key");
CREATE INDEX "deleted_files_removedAt_deletedAt_idx" ON "deleted_files"("removedAt", "deletedAt");
