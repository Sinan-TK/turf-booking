-- Photos of a unit (pitch, court, table…): up to three per unit, checked by the API. The file itself lives in object
-- storage; `key` is its path there.
CREATE TABLE "resource_photos" (
    "id" UUID NOT NULL,
    "resourceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resource_photos_resourceId_sortOrder_idx" ON "resource_photos"("resourceId", "sortOrder");

ALTER TABLE "resource_photos" ADD CONSTRAINT "resource_photos_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
