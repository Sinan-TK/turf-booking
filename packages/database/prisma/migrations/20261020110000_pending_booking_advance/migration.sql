-- Bookings still awaiting payment when three-part pricing arrived have no payment method yet, so the
-- earlier backfill left their online charge at 0. They are charged in full, as before.
UPDATE "bookings" SET "advanceAmount" = "amount" WHERE "status" = 'PENDING_PAYMENT' AND "advanceAmount" = 0;
