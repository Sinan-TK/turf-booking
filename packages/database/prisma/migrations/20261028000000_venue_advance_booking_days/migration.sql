-- How far ahead customers can book a venue: today and the next (n - 1) days. Owners choose 1 to 14 (checked by the
-- API); new and existing venues start at 7, which is what the customer site has always offered.
ALTER TABLE "venues" ADD COLUMN "advanceBookingDays" INTEGER NOT NULL DEFAULT 7;
