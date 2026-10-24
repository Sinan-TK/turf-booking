-- Emailed one-time codes replace the emailed reset links: they prove a mailbox when an email + password
-- account is created and when a password is reset.
DROP TABLE "customer_auth_tokens";

CREATE TABLE "customer_email_codes" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_email_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_email_codes_email_purpose_createdAt_idx" ON "customer_email_codes"("email", "purpose", "createdAt");
