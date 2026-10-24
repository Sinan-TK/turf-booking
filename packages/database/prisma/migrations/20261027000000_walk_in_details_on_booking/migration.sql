-- A walk-in is recorded by venue staff for someone who has no account: the person's name and phone now live on the
-- booking itself and are never linked to a customer account.
ALTER TABLE "slot_holds" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "bookings" ADD COLUMN "walkInName" TEXT;
ALTER TABLE "bookings" ADD COLUMN "walkInPhone" TEXT;

-- Existing walk-ins (paymentMethod OFFLINE): keep what was recorded on the booking and detach it from the customer
-- profile, so it no longer shows under that person's bookings.
UPDATE "slot_holds" h
SET "customerId" = NULL
FROM "bookings" b
WHERE b."slotHoldId" = h."id" AND b."paymentMethod" = 'OFFLINE';

UPDATE "bookings" b
SET "walkInName" = c."name", "walkInPhone" = c."whatsappNumber", "customerId" = NULL
FROM "customer_profiles" c
WHERE b."paymentMethod" = 'OFFLINE' AND b."customerId" = c."id";
