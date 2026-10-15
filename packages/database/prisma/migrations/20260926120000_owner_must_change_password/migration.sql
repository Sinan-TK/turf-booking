-- AlterTable
ALTER TABLE "turf_owner_users" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written on purpose: `prisma migrate dev` would also propose
-- `DROP COLUMN "during"` on resource_locks, the generated column that backs
-- the anti-double-booking exclusion constraint. Never apply that drop.
