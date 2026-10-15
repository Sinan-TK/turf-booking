-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "turf_owner_users" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- Note: prisma migrate diff also proposed `DROP COLUMN "during"` on
-- resource_locks. That column is intentionally NOT in schema.prisma (see
-- the init migration's hand-written block) — it's a generated column
-- Prisma doesn't know about, backing the anti-double-booking exclusion
-- constraint. Deliberately omitted here; do not apply that drop.
