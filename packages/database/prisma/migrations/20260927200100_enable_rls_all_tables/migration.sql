-- Hand-written: Prisma has no first-class RLS support.
--
-- Why this is needed even though our own backend never uses it: Prisma
-- connects as the Postgres superuser (DATABASE_URL), which always
-- bypasses RLS — this migration has zero effect on the NestJS API's own
-- access, which keeps working exactly as before.
--
-- What it actually closes: Supabase auto-exposes every `public` schema
-- table through its own separate REST API (PostgREST), using the `anon`
-- key. That key is necessarily public — it ships in apps/admin's and
-- apps/owner's browser bundle so Supabase Auth (sign-in, password reset)
-- can work at all. Without RLS, anyone who copies that key from dev
-- tools could query any table directly via Supabase's REST endpoint —
-- `https://<project>.supabase.co/rest/v1/bookings?select=*` — completely
-- bypassing every RolesGuard/ownership check in this codebase.
--
-- Enabling RLS with *no policies defined* is the fix: Postgres's default
-- for "RLS on, no policy matches" is deny-all, for every role including
-- `authenticated`. This app never queries business tables through
-- Supabase's REST API (only through Prisma, or through Supabase Auth's
-- own endpoints for identity), so there is no policy this app needs —
-- the correct policy set is empty, on purpose.
--
-- Applies to every table in `public` dynamically, so it can't go stale
-- as new tables/migrations are added — no fixed table list to remember
-- to update.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
