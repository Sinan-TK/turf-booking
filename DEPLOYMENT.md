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
- Redis is required (WhatsApp session state, jobs).

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
