-- A price now has three parts: normal (the full price), an optional offer below it, and the booking
-- price (the advance paid online). Existing prices become the normal price, with booking = normal so
-- nothing changes for current venues until an owner lowers the booking price or adds an offer.
ALTER TABLE "pricing_rules" RENAME COLUMN "price" TO "normalPrice";
ALTER TABLE "pricing_rules" ADD COLUMN "offerPrice" DECIMAL(12,2);
ALTER TABLE "pricing_rules" ADD COLUMN "bookingPrice" DECIMAL(12,2);
UPDATE "pricing_rules" SET "bookingPrice" = "normalPrice";
ALTER TABLE "pricing_rules" ALTER COLUMN "bookingPrice" SET NOT NULL;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_offer_below_normal"
  CHECK ("offerPrice" IS NULL OR ("offerPrice" >= 0 AND "offerPrice" < "normalPrice"));
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_booking_within_full"
  CHECK ("bookingPrice" >= 0 AND "bookingPrice" <= COALESCE("offerPrice", "normalPrice"));

-- Bookings keep `amount` as the full price and record what was charged online and what is collected.
ALTER TABLE "bookings" ADD COLUMN "advanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
-- Existing online bookings were charged in full; walk-ins were paid at the venue in full.
UPDATE "bookings" SET "advanceAmount" = "amount" WHERE "paymentMethod" IN ('MONEY', 'COINS');
UPDATE "bookings" SET "paidAmount" = "amount" WHERE "status" IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW');
