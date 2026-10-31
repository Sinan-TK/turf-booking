# Deployment: portals on subdomains

One pnpm/Turborepo monorepo, deployed as three separate units over HTTPS:

| Unit | Host | Domain |
|---|---|---|
| `apps/admin` | Vercel project (Root Directory `apps/admin`) | `admin.example.com` |
| `apps/owner` | Vercel project (Root Directory `apps/owner`) | `owner.example.com` |
| `apps/api` + Postgres 16 + Redis | VPS / Render / Railway | `api.example.com` |

## Auth and cookies (do not change)

- Auth cookies are `httpOnly`, `sameSite=lax`, and **host-only on `api.example.com`**. Never set `Domain=.example.com` to share them; the two portals use distinct cookie names (`admin_*`, `owner_*`) and must stay isolated.
- `admin.` / `owner.` / `api.` share a registrable domain, so they are same-site and `lax` cookies attach to credentialed fetches. This does not work across unrelated root domains.
- The portals call the API with `credentials: 'include'` (`lib/api.ts`). The API must allow each portal origin via credentialed CORS: `ADMIN_APP_URL`, `OWNER_APP_URL`, `WEB_APP_URL` (`apps/api/src/main.ts`).
- Production startup **fails fast** if those URLs are not exact `https` origins (no trailing slash/path), if secrets are `dev_only*` placeholders, or if `AUTH_JWT_SECRET` is a `dev_only*` placeholder (`packages/config/src/env.ts`).

## API environment (production)

```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB
REDIS_URL=redis://HOST:6379
AUTH_JWT_SECRET=<openssl rand -hex 32>      # signs admin/owner access tokens
RESEND_API_KEY=re_...                        # invite + password-reset emails (unset = links only logged)
MAIL_FROM="Venue Booking <no-reply@example.com>"   # must be a Resend-verified sender/domain
CUSTOMER_SESSION_SECRET=<openssl rand -hex 32>
ADMIN_APP_URL=https://admin.example.com
OWNER_APP_URL=https://owner.example.com
WEB_APP_URL=https://example.com
RAZORPAY_KEY_ID=...  RAZORPAY_KEY_SECRET=...  RAZORPAY_WEBHOOK_SECRET=...
WHATSAPP_*=...
GOOGLE_CLIENT_ID=<Google Cloud OAuth Web client ID>   # GOOGLE_AUTH_MODE must stay "google" (fake is refused)
TRUST_PROXY=<see below>
```

### `TRUST_PROXY`: verify, do not guess

`req.ip` feeds the rate limiter (login: 10/min per IP) and audit logs. Behind a proxy it is the proxy's IP unless Express is told how many hops to trust. Too low: every user shares one rate-limit bucket. Too high: a client can spoof `X-Forwarded-For` and dodge limits.

1. Find your real topology (e.g. Render/Railway: usually 1 hop; Cloudflare in front of a host: 2; Nginx on a VPS: 1; direct to Node: 0).
2. Set `TRUST_PROXY=<hops>` (or `loopback` / a CIDR list). Unset = trust nothing. `true` is rejected as unsafe.
3. Verify: log `req.ip` (or check an audit-log row) from a known client IP, and from a client sending a forged `X-Forwarded-For`; the forged header must not change the recorded IP.

## Portals (Vercel, one project each)

- Env: `NEXT_PUBLIC_API_URL=https://api.example.com` (baked at build time; redeploy to change).
- Install: `pnpm install` at repo root (enable "include files outside the Root Directory"). Build: `pnpm --filter @venue/admin build` / `pnpm --filter @venue/owner build`.

### Google sign-in

Customers can sign in with Google. Owner-portal and Super Admin users sign in with email and password only. In Google Cloud: OAuth consent screen,
then Credentials > OAuth client ID > Web application. Add the customer site origin (and
`http://localhost:3000` for development) under Authorized JavaScript origins; no redirect URI is needed.
Set the same ID as `GOOGLE_CLIENT_ID` on the API and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on the customer app
(build time). Customers can also
use email + password: creating the account and resetting the password both need a 6-digit code emailed to the address,
so `RESEND_API_KEY` and `MAIL_FROM` are required in production (without them the code is only written to the API log).
To style these emails, create a Resend template from `docs/email-templates/otp-code.html` (variables `HEADING`, `INTRO`,
`CODE`, `NAME`, `EXPIRES_IN_MINUTES`), publish it and set its id as `RESEND_OTP_TEMPLATE_ID`; unset sends a plain email. The WhatsApp-code login stays in the API
but is hidden in the customer app unless `NEXT_PUBLIC_CUSTOMER_LOGIN_METHODS` includes `phone` (default `google,email`).

## API release order

```
pnpm install
pnpm db:generate
pnpm build
pnpm --filter @venue/database migrate:deploy   # never `migrate dev` in production
node apps/api/dist/main.js
```

- Postgres needs the `btree_gist` extension (created by the first migration). The `no_overlapping_resource_locks` exclusion constraint is what prevents double booking; `migrate dev` would drop its backing `resource_locks.during` column.
- Create the first Super Admin with `pnpm --filter @venue/database exec tsx prisma/provision-admin.ts <email> "<name>"` (e.g. via `railway run`). It prints a single-use set-password link; open it, choose a password, sign in. Never run `seed:identity` in production (it refuses to).
- Migration `20261015000000_rename_turf_to_venue` only renames tables, columns, the status enum and the policy-scope enum value (no data is rewritten). The API and all three portals must be deployed together with it: the old API cannot read the renamed tables, and the old portals call `/turfs/*` paths that no longer exist. Staff sessions issued before the rename carry the old `TURF_OWNER` role, so owners sign in again once. Historical `audit_logs` rows keep their old `TURF_*` action names.
- Redis is not used by the API today: scheduled jobs (hold expiry, completing and settling played bookings, preparing payouts) run inside the API process via `@nestjs/schedule`. Run **one** API instance, or move those jobs to a single worker, before scaling out (the rate limiter's counters are also per instance).

## Commission, cancellation and weekly payouts

- Terms live in `commercial_policies` (platform default → facility → one venue's own deal, merged field by field) and are edited by the Super Admin: **Commercial terms** (platform default, payout day) and each facility's page (commission tiers, monthly cap, fee after the cap, minimum advance, cancellation windows and cut-off). Nothing commercial is hard-coded. A booking keeps the terms it was made under (`bookings.commercialTerms`), so later edits never change it.
- Played bookings are completed and settled every 5 minutes (`SettlementsService.completeAndSettle`); payouts for slots before the payout day are prepared hourly and on demand (`POST /admin/payouts/run`). The admin pays each owner by bank transfer and marks the payout paid with the transfer reference (**Payouts** page). Razorpay Route automation is a later step.
- Refunds are only ever coins. Cancelling inside the cut-off is blocked for customers; owners and admins can always cancel and refund everything as coins.
- Tests must not run against a shared database: put `DATABASE_URL` of a local Postgres (`docker compose up -d`, then `prisma migrate deploy` and the seed) in `apps/api/.env.test` (gitignored). The Playwright helpers read `DATABASE_URL` from the environment first, so set it to the same local database when running `pnpm e2e`.

## Post-deploy verification

1. `GET https://api.example.com/health` is ok.
2. Log in on both portals; confirm the cookie is `HttpOnly; Secure; SameSite=Lax`, host `api.example.com`, and no CORS errors.
3. Owner session gets 403 on `/admin/*`; being logged into both portals at once works.
4. Rate limiting is per real client IP (see `TRUST_PROXY`).
5. `\d resource_locks` shows `no_overlapping_resource_locks`.

## Security behaviours to know about

- **Admin/owner accounts** are passwordless until the user opens the emailed invite link (`/reset-password?token=…`, single use, 72h by default) and chooses a password; such an account cannot log in before that. Access tokens are short-lived (15 min) JWTs in an `httpOnly` cookie; the refresh token (14 days) is rotated on every use, and replaying a rotated token revokes all of that user's sessions. Changing/resetting a password or disabling a user ends their sessions (a disabled user loses access at the latest at the next refresh).
- **Customer login** is a phone number plus a 6-digit one-time code (`/customer-auth/*`). Codes are stored hashed, expire after `OTP_TTL_MINUTES` (5), allow `OTP_MAX_ATTEMPTS` (5) tries, and are limited per phone (`OTP_MAX_CODES_PER_HOUR`, `OTP_RESEND_COOLDOWN_SECONDS`) and per IP. A successful login sets the httpOnly `customer_session` cookie (`CUSTOMER_SESSION_TTL_HOURS`, default 168). Production must set `AUTH_OTP_DELIVERY=whatsapp` (the API refuses to start with `log`) and should set `WHATSAPP_OTP_TEMPLATE` to an approved WhatsApp authentication template; `AUTH_OTP_DELIVERY=log` prints the code in the API log and is for local development only.
- **Migrations:** the `local_staff_auth` migration is hand-written (it replaces the Supabase link on admin/owner users with `passwordHash`). Existing admin/owner rows survive but have no password until re-provisioned (`provision-admin.ts`, or "Forgot password" on the portal login).

## Booking lengths and block pricing

- Every unit (pitch, court, table…) has its own shortest and longest booking (`resources.minDurationMinutes` / `maxDurationMinutes`). The longest must be a whole multiple of the shortest, and the shortest a multiple of the venue type's start gap (`slotIntervalMin`). The owner sets both when adding a unit and can change them on the venue page (`PATCH /resources/:id/durations`).
- A unit's price is **per block of its shortest booking**. A booking of n blocks costs the sum of n block prices, each looked up at the time that block starts (peak and off-peak apply block by block). The booking keeps its per-block breakdown in `priceSnapshot.blocks`. The online advance is the sum of the blocks' booking prices, raised once to the facility's minimum advance on the total.
- Migration `20261031000000_unit_min_max_duration` gives each existing unit its shortest booking from its smallest priced duration (a unit with no prices takes its venue type's value) and switches off (not deletes) its prices for longer durations. Multi-hour discounts of the old per-duration model therefore go away; owners can delete the switched-off rows from the prices page. Existing bookings are untouched.
- Pooled groups (kayak fleets) still use one price per duration.
- A search with no `durationMinutes` shows every unit at its own shortest booking; with one, units that offer that length use it and the others fall back to their own shortest (each result says which in `durationMinutes`).

## Dependency vulnerability checks

- `.github/workflows/dependency-audit.yml` runs weekly (Monday 04:00 UTC), on pull requests that touch a `package.json`, the lockfile or the baseline, and on demand. It runs `node scripts/audit-check.mjs` (also `pnpm audit:check` locally).
- The gate fails on any HIGH or CRITICAL advisory in the production dependencies that is not listed in `.github/audit-baseline.json`, and on a listed one after its `reviewBy` date. Moderate and low advisories are reported only.
- The baseline holds what was reviewed and accepted for now, each with a reason. Today that is mostly Next.js 14 (fixed only in 15.x: a separate migration), zod 3 and the build tools bundled in Next. Remove an entry when the advisory is fixed (the script lists entries that no longer apply).
- `.github/dependabot.yml` opens weekly update PRs (npm grouped minor/patch, GitHub Actions, Docker). Major upgrades of Next, NestJS and zod are left out on purpose.
- Transitive fixes that need no major upgrade are pinned in the root `package.json` under `pnpm.overrides`.
- The image optimizer is switched off in all three Next apps (`images.unoptimized`), as none of them use `next/image`.

## Content Security Policy (web, admin, owner)

Each app's `middleware.ts` sets a policy per request, built by `packages/shared/src/csp.ts`. Scripts: `'self'` plus a fresh nonce and `'strict-dynamic'` (no `unsafe-inline`; `unsafe-eval` only in development). Styles: own files and Google Fonts; style *attributes* are allowed inline (`style-src-attr`). Also `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Any CSP or `x-nonce` header a visitor sends is discarded. Pages render per request (the root layout reads headers) so the nonce can change each time.

- `CSP_MODE` (set on each web app): `enforce` (default in production) blocks; `report-only` only reports; `off` removes the header. To trial a change, deploy with `report-only` and watch the API log for `[csp]` lines (browsers post to `POST /csp-report`, throttled, logged without query strings, never stored).
- `NEXT_PUBLIC_API_URL` is added to `connect-src` and `img-src` automatically. Set `CSP_IMG_ORIGINS` (space or comma separated origins) to the public photo storage origin (the host of `STORAGE_PUBLIC_URL`) on every app that shows photos, or production photos will be blocked.
- Customer site only: Google sign-in, Razorpay checkout (`checkout.razorpay.com`, `api.razorpay.com`, `lumberjack.razorpay.com`) and `style-src-elem 'unsafe-inline'`, because Google's sign-in script writes its button styles as an inline `<style>` and the button renders broken without it. If Razorpay or Google change the hosts they use, the browser console and the API log show the blocked host: add it in `apps/web/middleware.ts`.
- Admin and owner: map pins from `unpkg.com` and tiles from `*.tile.openstreetmap.org` (images only).
- `apps/e2e/tests/*/csp.spec.ts` open the main pages and fail on any violation, check a fresh nonce per request, and check a hostile inbound policy is ignored. The Razorpay checkout page itself is not covered by a browser test (it needs a real payment order): after a deploy, make a test payment with `CSP_MODE=report-only` first.

## API health on the Super Admin pages

`GET /health` is the public probe (200 `{status:'ok'}`, 503 `{status:'down'}` when the database does not answer; the Docker health check uses it). `GET /admin/system/health` (Super Admin only) adds per-part checks, response time and uptime, with fixed messages only (no connection strings or error text; the real error goes to the log). The admin dashboard shows a status card and every admin page a status dot in the sidebar; both refresh every 30 seconds while the tab is visible and when it regains focus, and tell "API up, database down" apart from "API unreachable".

## Facility pictures (storage folder)

A Super Admin can give each facility a picture (admin: Facilities > the facility > Basics > Picture). It saves at once, is shrunk to WebP in the browser (longest side 1200px), checked by its first bytes on the API (JPEG, PNG or WebP, 5 MB at most), and shown in the customer site's "Venue types" picker. Files live in their own top-level folder of the bucket, `facilities/<facilityId>/<uuid>.<ext>` (unit photos stay under `venues/...`); replacing or removing a picture, or deleting the facility, deletes the old file. Migration `20261103000000_category_image` adds `venue_categories.imageKey`; it must be applied before the new API starts. The public URL comes from `STORAGE_PUBLIC_URL`, so that origin must be in `CSP_IMG_ORIGINS` on the customer site (see the CSP section), as for unit photos.

## Locations (states, districts, areas)

The Super Admin manages the whole tree under Locations: states (with a code such as KL or TN), the districts in each (code and timezone) and the areas (towns, with an optional centre so customers can search near them). Each can be edited and switched off; the codes cannot be changed because they are part of facility codes already handed out. A switched-off state hides its districts and areas from customers and forms, but nothing is deleted. The customer site's location picker is one searchable list of every active area as "Area, District, State" (`GET /places`), whatever the state; an area without a centre stands for its whole district. Changes are recorded in the audit log (`LOCATION_*` actions).

## Landing page and banners (customer site)

`/` is now a landing page (hero search, advertising banners, browse by venue type, how it works, a "List your venue" call to action); the venue search and listing moved to `/explore` (`/explore?q=…` pre-fills the search, `/explore?type=FOOTBALL_TURF` picks a venue type; the old `/book/:token` redirect lands there too). Set `NEXT_PUBLIC_OWNER_URL` (build-time, customer site) to the owner portal's address for the "List your venue" button (default `http://localhost:3002`).

Banners are managed by the Super Admin under Platform > Banners: title, optional line, optional picture (framed 16:5 in the browser, JPEG/PNG/WebP, stored in their own `banners/` folder of the bucket), where a tap goes (a path on the site or an https address; anything else is refused), start and end dates, order and an on/off switch. The public list (`GET /banners`) returns only what is on and inside its dates. Migration `20261104000000_banners` creates the table and must be applied before the new API starts; banner pictures need the storage origin in `CSP_IMG_ORIGINS`, as for the other photos.
