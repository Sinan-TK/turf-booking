-- Hand-written, not `prisma migrate dev` generated: adding a required
-- (NOT NULL) supabaseUserId column can't be auto-generated against
-- tables that already have rows without a default value to backfill
-- with, and this environment can't answer `migrate dev`'s interactive
-- prompt either way. Every admin_users/turf_owner_users row is being
-- recreated against Supabase Auth as part of this change (see
-- ARCHITECTURE.md's identity-migration notes), so there is deliberately
-- no data to preserve here — old rows are dropped outright rather than
-- carrying a fabricated supabaseUserId.
--
-- Never apply a `DROP COLUMN "during"` on resource_locks here or in any
-- future migration — see the init migration's own comment. That column
-- is intentionally absent from schema.prisma; it backs the
-- no_overlapping_resource_locks exclusion constraint that prevents
-- double booking.

DELETE FROM "turf_owner_users";
DELETE FROM "admin_users";

-- AdminUser: drop password/session-management columns Supabase now owns
ALTER TABLE "admin_users" DROP COLUMN "passwordHash";
ALTER TABLE "admin_users" DROP COLUMN "tokenVersion";
ALTER TABLE "admin_users" DROP COLUMN "lastLoginAt";
ALTER TABLE "admin_users" ADD COLUMN "supabaseUserId" UUID NOT NULL;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_supabaseUserId_key" UNIQUE ("supabaseUserId");

-- TurfOwnerUser: same, plus mustChangePassword (Supabase's own invite
-- flow makes this concept obsolete — an invited user has no password at
-- all until they set one via Supabase's own email link).
ALTER TABLE "turf_owner_users" DROP COLUMN "passwordHash";
ALTER TABLE "turf_owner_users" DROP COLUMN "tokenVersion";
ALTER TABLE "turf_owner_users" DROP COLUMN "mustChangePassword";
ALTER TABLE "turf_owner_users" DROP COLUMN "lastLoginAt";
ALTER TABLE "turf_owner_users" ADD COLUMN "supabaseUserId" UUID NOT NULL;
ALTER TABLE "turf_owner_users" ADD CONSTRAINT "turf_owner_users_supabaseUserId_key" UNIQUE ("supabaseUserId");
