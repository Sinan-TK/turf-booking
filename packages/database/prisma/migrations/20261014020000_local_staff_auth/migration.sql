-- Replaces Supabase Auth with API-owned credentials for admin/owner users.
-- Hand-written. Existing admin_users/turf_owner_users rows are KEPT (so
-- their FK-linked data survives) but lose their Supabase link; they get
-- passwordHash = NULL and can't log in until re-provisioned (provision-admin
-- script, or the forgot-password / invite flow).
--
-- Never apply a `DROP COLUMN "during"` on resource_locks or
-- inventory_reservations here or in any future migration — see the init
-- migration's own comment. It backs the double-booking exclusion constraint.

ALTER TABLE "admin_users" DROP COLUMN "supabaseUserId";
ALTER TABLE "admin_users" ADD COLUMN "passwordHash" TEXT;

ALTER TABLE "turf_owner_users" DROP COLUMN "supabaseUserId";
ALTER TABLE "turf_owner_users" ADD COLUMN "passwordHash" TEXT;

CREATE TYPE "StaffPortal" AS ENUM ('ADMIN', 'OWNER');
CREATE TYPE "StaffAuthTokenPurpose" AS ENUM ('INVITE', 'PASSWORD_RESET');

CREATE TABLE "staff_auth_tokens" (
    "id" UUID NOT NULL,
    "portal" "StaffPortal" NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "StaffAuthTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_auth_tokens_tokenHash_key" ON "staff_auth_tokens"("tokenHash");
CREATE INDEX "staff_auth_tokens_portal_userId_idx" ON "staff_auth_tokens"("portal", "userId");

CREATE TABLE "staff_refresh_sessions" (
    "id" UUID NOT NULL,
    "portal" "StaffPortal" NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_refresh_sessions_tokenHash_key" ON "staff_refresh_sessions"("tokenHash");
CREATE INDEX "staff_refresh_sessions_portal_userId_idx" ON "staff_refresh_sessions"("portal", "userId");

-- Same posture as every other public table (see enable_rls_all_tables).
ALTER TABLE "staff_auth_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_refresh_sessions" ENABLE ROW LEVEL SECURITY;
