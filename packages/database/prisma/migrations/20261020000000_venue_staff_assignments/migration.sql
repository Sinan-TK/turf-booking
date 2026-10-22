-- Which venues an OWNER_STAFF user may work in (OWNER_ADMIN reaches every venue of the organization).
CREATE TABLE "venue_staff_assignments" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venue_staff_assignments_ownerUserId_venueId_key" ON "venue_staff_assignments"("ownerUserId", "venueId");
CREATE INDEX "venue_staff_assignments_venueId_idx" ON "venue_staff_assignments"("venueId");

ALTER TABLE "venue_staff_assignments" ADD CONSTRAINT "venue_staff_assignments_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "venue_owner_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "venue_staff_assignments" ADD CONSTRAINT "venue_staff_assignments_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
