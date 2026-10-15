-- Adds the OFFLINE value to PaymentMethod for owner-recorded walk-in
-- bookings (no gateway Payment row, Booking goes straight to CONFIRMED).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction alongside
-- other statements in the same migration on older Postgres, so this
-- migration contains only this one statement.
ALTER TYPE "PaymentMethod" ADD VALUE 'OFFLINE';
