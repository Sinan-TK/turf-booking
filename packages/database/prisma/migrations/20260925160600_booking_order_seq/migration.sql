-- Backing sequence for Booking.orderSeq / formatOrderId() (ARCHITECTURE.md
-- "Order ID" section + §5.2). A plain Postgres sequence rather than a
-- Prisma @default(autoincrement()) column so the booking service can grab
-- the next value with SELECT nextval(...) *before* the INSERT and use it
-- to compute the human-readable orderId in the same statement, instead of
-- inserting then updating.
CREATE SEQUENCE IF NOT EXISTS booking_order_seq START WITH 10000;

-- The init migration's @default(autoincrement()) created an
-- implicit identity sequence for this column; replaced by the explicit
-- one above (schema.prisma no longer declares a default).
ALTER TABLE "bookings" ALTER COLUMN "orderSeq" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "bookings_orderSeq_seq";
