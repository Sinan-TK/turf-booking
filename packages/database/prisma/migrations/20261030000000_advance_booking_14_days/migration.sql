-- Customers can now book two weeks ahead by default (it was one week). Venues still on the old default of 7 move to 14;
-- owners can still choose anything from 1 to 14.
ALTER TABLE "venues" ALTER COLUMN "advanceBookingDays" SET DEFAULT 14;
UPDATE "venues" SET "advanceBookingDays" = 14 WHERE "advanceBookingDays" = 7;
