-- Owner and staff sign in with email and password only; Google sign-in is for customers (customer_profiles.googleSub stays).
DROP INDEX "venue_owner_users_googleSub_key";
ALTER TABLE "venue_owner_users" DROP COLUMN "googleSub";
