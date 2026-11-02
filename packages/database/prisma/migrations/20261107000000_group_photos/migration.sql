-- A pooled group (a kayak fleet) can have photos too: a photo belongs to a unit or to a group, never both.
ALTER TABLE "resource_photos" ALTER COLUMN "resourceId" DROP NOT NULL;
ALTER TABLE "resource_photos" ADD COLUMN "resourceGroupId" UUID;
ALTER TABLE "resource_photos" ADD CONSTRAINT "resource_photos_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "resource_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "resource_photos_resourceGroupId_sortOrder_idx" ON "resource_photos"("resourceGroupId", "sortOrder");
ALTER TABLE "resource_photos" ADD CONSTRAINT "resource_photos_one_owner" CHECK (num_nonnulls("resourceId", "resourceGroupId") = 1);
