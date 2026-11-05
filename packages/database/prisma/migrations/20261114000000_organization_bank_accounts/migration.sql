-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('SAVINGS', 'CURRENT');

-- CreateEnum
CREATE TYPE "BankAccountStatus" AS ENUM ('NOT_VERIFIED', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "organization_bank_accounts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "accountHolderName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branch" TEXT,
    "accountType" "BankAccountType" NOT NULL DEFAULT 'SAVINGS',
    "upiId" TEXT,
    "status" "BankAccountStatus" NOT NULL DEFAULT 'NOT_VERIFIED',
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByAdminId" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_bank_accounts_organizationId_key" ON "organization_bank_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "organization_bank_accounts_status_idx" ON "organization_bank_accounts"("status");

-- AddForeignKey
ALTER TABLE "organization_bank_accounts" ADD CONSTRAINT "organization_bank_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "owner_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
