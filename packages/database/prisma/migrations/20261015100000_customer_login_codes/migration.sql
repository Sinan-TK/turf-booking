-- Additive only: one new enum value, one new table. Nothing existing is
-- altered, dropped or rewritten; resource_locks is not referenced.
ALTER TYPE "CustomerSessionSourceLinkType" ADD VALUE IF NOT EXISTS 'LOGIN';

CREATE TABLE "login_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_codes_phone_createdAt_idx" ON "login_codes"("phone", "createdAt");
