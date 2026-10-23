-- Customer sign-in with Google, email + password and (hidden) phone code; owner-portal Google sign-in.
-- Hand-written: `prisma migrate diff` also proposes dropping the `during` columns that back the
-- no-double-booking constraints, which must stay.

-- The phone is no longer the only identity: nullable, and unique only among VERIFIED numbers.
ALTER TABLE "customer_profiles" ALTER COLUMN "whatsappNumber" DROP NOT NULL;
DROP INDEX "customer_profiles_whatsappNumber_key";

ALTER TABLE "customer_profiles" ADD COLUMN "phoneVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "customer_profiles" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "customer_profiles" ADD COLUMN "passwordHash" TEXT;

-- Everyone who has ever logged in did so by a one-time code sent to that number, so it is verified.
-- Profiles that only exist because venue staff typed a walk-in customer's number stay unverified.
UPDATE "customer_profiles" c
SET "phoneVerified" = true
WHERE c."whatsappNumber" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "customer_sessions" s WHERE s."customerId" = c."id");

CREATE UNIQUE INDEX "customer_profiles_whatsapp_verified_key" ON "customer_profiles"("whatsappNumber") WHERE "phoneVerified";
CREATE INDEX "customer_profiles_whatsappNumber_idx" ON "customer_profiles"("whatsappNumber");
CREATE UNIQUE INDEX "customer_profiles_googleSub_key" ON "customer_profiles"("googleSub");

CREATE TABLE "customer_auth_tokens" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_auth_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_auth_tokens_tokenHash_key" ON "customer_auth_tokens"("tokenHash");
CREATE INDEX "customer_auth_tokens_customerId_idx" ON "customer_auth_tokens"("customerId");
ALTER TABLE "customer_auth_tokens" ADD CONSTRAINT "customer_auth_tokens_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "venue_owner_users" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "venue_owner_users_googleSub_key" ON "venue_owner_users"("googleSub");
