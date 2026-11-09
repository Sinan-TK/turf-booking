-- A payout is created automatically on its organization's payout day in the INITIATED state (it was PENDING).
ALTER TYPE "PayoutStatus" RENAME VALUE 'PENDING' TO 'INITIATED';

-- Each organization can have its own weekly payout day (ISO weekday, 1 = Monday ... 7 = Sunday); null follows the platform default.
ALTER TABLE "owner_organizations" ADD COLUMN "payoutWeekday" INTEGER;
