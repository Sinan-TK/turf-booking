-- Payments that are still being confirmed, how a booking was paid (Coins or money), venue contact numbers and wallet recharges.

-- New values are only added here and used by later migrations/code (an enum value cannot be used in the transaction that adds it).
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "BookingCancellationReasonCode" ADD VALUE IF NOT EXISTS 'PAYMENT_NOT_CONFIRMED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "CoinTransactionType" ADD VALUE IF NOT EXISTS 'WALLET_TOPUP';

CREATE TYPE "PaymentConfirmedVia" AS ENUM ('WEBHOOK', 'CLIENT', 'RECONCILER');
CREATE TYPE "WalletTopupStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED');

ALTER TABLE "bookings"
  ADD COLUMN "coinsPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "moneyPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "processingUntil" TIMESTAMPTZ;

-- What bookings already paid online: the successful payments they have (Coins or Razorpay).
UPDATE "bookings" b
SET "coinsPaid" = COALESCE((SELECT SUM(p."amount") FROM "payments" p WHERE p."bookingId" = b."id" AND p."provider" = 'COINS' AND p."status" IN ('SUCCESS', 'REFUNDED')), 0),
    "moneyPaid" = COALESCE((SELECT SUM(p."amount") FROM "payments" p WHERE p."bookingId" = b."id" AND p."provider" = 'RAZORPAY' AND p."status" IN ('SUCCESS', 'REFUNDED')), 0);

ALTER TABLE "payments"
  ADD COLUMN "clientVerifiedAt" TIMESTAMPTZ,
  ADD COLUMN "confirmedVia" "PaymentConfirmedVia";

ALTER TABLE "venues" ADD COLUMN "contactPhone" TEXT;

CREATE TABLE "wallet_topups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" "WalletTopupStatus" NOT NULL DEFAULT 'PENDING',
  "gatewayOrderId" TEXT NOT NULL,
  "gatewayPaymentId" TEXT,
  "confirmedVia" "PaymentConfirmedVia",
  "clientVerifiedAt" TIMESTAMPTZ,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_topups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_topups_gatewayOrderId_key" ON "wallet_topups"("gatewayOrderId");
CREATE UNIQUE INDEX "wallet_topups_gatewayPaymentId_key" ON "wallet_topups"("gatewayPaymentId");
CREATE INDEX "wallet_topups_customerId_createdAt_idx" ON "wallet_topups"("customerId", "createdAt");
ALTER TABLE "wallet_topups" ADD CONSTRAINT "wallet_topups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "coin_transactions" ADD COLUMN "walletTopupId" UUID;
ALTER TABLE "coin_transactions" ADD CONSTRAINT "coin_transactions_walletTopupId_fkey" FOREIGN KEY ("walletTopupId") REFERENCES "wallet_topups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
