# Clean backend architecture and website-only booking — design

Status: **draft for review** (no code has been changed for this spec).
Date: 2026-10-15

## 1. Goals

1. Restructure the NestJS API into consistent layers so it scales and stays
   clean as modules are added.
2. Remove booking through WhatsApp. The customer website becomes the only
   place to search, book, pay and manage bookings. WhatsApp becomes
   **send-only** (login codes, confirmations, reminders, cancellation/refund
   notices). The WhatsApp chat menu is removed entirely.
3. Deliver it **slowly and safely**: one stage at a time, every stage ending
   green (typecheck, lint, build, full e2e suite) with a written report, and
   no next stage until the user approves.

### Non-goals
- Domain behaviour changes (booking policy, pricing, refunds, locks stay as
  they are; the tests are the guard).
- Renaming domain concepts again, or moving to microservices / separate
  packages per context.
- Any change to the `resource_locks.during` column or the
  `no_overlapping_resource_locks` exclusion constraint.
- Pricing fallback for unpriced durations (still awaiting approval).
- SMS/email channels (the notification port makes them possible later).

## 2. Current state (verified)

- NestJS modular monolith, ~25 modules, ~10k lines, no circular module
  dependencies.
- **Consistent today:** bookings, payments, coins, availability and
  notifications use a repository port with a Prisma implementation; pure
  rule code exists in `scheduling/` and `policy-validation.ts`.
- **Inconsistent:** 19 other modules inject `PrismaService` directly into
  services (venues, resources, venue-config, venue-categories, support,
  dashboard, policies, customers, locations, owner-organizations,
  saved-venues, auth, identity, jobs, audit, booking-sessions, …).
- **Oversized:** `bookings.service.ts` (844 lines: hold, pooled stock, offline
  walk-in, cancel, notifications, WhatsApp text) and
  `whatsapp-menu.service.ts` (737 lines: chat state machine plus booking
  logic).
- **WhatsApp coupling:** `bookings`, `payments` and `coins` import
  `WhatsAppClientService` directly.
- **Customer identity:** a customer is a WhatsApp number. The website is
  reachable only through a link the bot sends (`booking-sessions`). Redis is
  used only by `whatsapp-session.service.ts`.
- Test base: 17 e2e suites / 99 tests against the Neon dev database.

## 3. Target architecture

Every module has the same four layers:

```
<module>/
  api/             controllers + request/response DTOs (HTTP only)
  application/     use-cases / services: orchestrate, own transactions,
                   declare the ports (repository, notifier) they need
  domain/          pure rules and types: no Nest, no Prisma, no I/O
  infrastructure/  Prisma repositories and external adapters implementing ports
```

### Rules (enforced by an ESLint import-boundary check)
1. Controllers parse the request, call one application service, shape the
   response. No business logic, no database access.
2. Only `infrastructure/` imports Prisma. Application code depends on a
   repository **interface** (injected by token), never on `PrismaService`.
3. `domain/` imports nothing from Nest, Prisma or other layers. Booking
   policy, pricing selection, refund tiers and state transitions live here as
   pure functions, unit-tested without a database.
4. Notifications go through one `NotificationPort`
   (`notifyBookingConfirmed(...)`, `sendLoginCode(...)`, …). Only the WhatsApp
   adapter knows Meta exists. Bookings, payments and coins no longer import
   anything from `whatsapp/`.
5. A module may use another module only through that module's exported
   application service or port, never its tables or repositories.

The check starts as warnings (Stage 1) and becomes an error once all modules
are migrated (Stage 9).

Shared kernel (`common/`): typed domain errors mapped to HTTP in one filter,
a `UnitOfWork`/transaction port so application code can run multi-repository
transactions without Prisma, an `AuthContext` type, and the `Clock` helper
for testable time.

## 4. Customer journey on the website

1. **Browse:** search and slot viewing need no login (unchanged).
2. **Book:** choosing a slot requires login. Phone number, then a 6-digit
   code sent through the `NotificationPort` over WhatsApp. First-time
   customers enter their name. After login the customer returns to the
   chosen slot.
3. **Hold and pay:** the slot is held for `SLOT_HOLD_TTL_MINUTES` (10) with a
   visible countdown; pay with Razorpay or Coins; confirmation page.
4. **Account:** My bookings (view, cancel with refund preview), Coins wallet,
   saved venues, profile, support tickets. These replace the WhatsApp menu.
5. **Auto-reply:** a message sent to the WhatsApp number gets one reply
   pointing to the website.

### Login code rules
- 6 digits, stored hashed, valid 5 minutes, max 5 attempts per code, resend
  cooldown 30 s, per-phone and per-IP rate limits, single use.
- Session: httpOnly cookie (same pattern as staff sessions), refresh handled
  server-side; existing `CustomerSession` model reused.
- Meta only permits a login code to a new user through an approved
  **authentication template**. Until it is approved, `AUTH_OTP_DELIVERY=log`
  (development only) prints the code to the server log; production refuses
  to start with `log`.

## 5. Stages (each ends green with a report; stop for approval)

| # | Stage | Notes |
|---|---|---|
| 1 | **Foundation**: `NotificationPort` + WhatsApp adapter (outbound only), shared kernel, boundary lint (warn) | No behaviour change. Bookings/payments/coins stop importing WhatsApp. |
| 2 | **Customer login API**: OTP request/verify endpoints, `login_codes` table, rate limits, cookie session | Additive migration only; SQL reviewed before applying; dev DB only. |
| 3 | **Customer website**: login, booking (hold, pay, confirm), My bookings, wallet, saved venues, profile, support | Replaces `/book/[token]`. Responsive at phone/tablet/laptop. |
| 4 | **Retire WhatsApp booking**: remove menu state machine, booking-session links, book-intent parser, Redis session state; keep webhook auto-reply | Old `/book/[token]` links stop working. Redis dependency dropped from config/docs. |
| 5 | Refactor small modules: locations, policies, owner-organizations, saved-venues, support, customers, dashboard, audit | Proves the pattern. |
| 6 | Refactor catalogue: venue-categories, venues, resources, venue-config | |
| 7 | Refactor scheduling and money: scheduling, availability, coins, payments | |
| 8 | Refactor bookings: split into hold, pooled stock, offline walk-in, cancel and expiry use-cases | Highest risk, done last. |
| 9 | Refactor auth/identity; turn boundary lint into an error | |

## 6. Verification and safety

Every stage: `pnpm typecheck`, `pnpm lint`, `pnpm build` (never while the
matching dev server runs), `typecheck:e2e`, and the full e2e suite; plus a
report listing files moved, tests added and any invariant concern.

Standing safety rules (carried over from the venue-types work):
- Dev database only; print and confirm the target before any migration.
- No resets, no deletion of bookings, payments, refunds or coin records.
- Migrations are additive and reviewed before applying; `resource_locks`
  and its exclusion constraint are never touched.
- Authentication and authorization behaviour is preserved; new customer
  login is covered by tests (expiry, attempts, rate limit, reuse).
- Refactor stages are **move-and-prove**: a module's existing tests must
  pass unchanged before and after; new unit tests cover extracted domain
  code.
- Work happens without git history here (no `.git`); a source backup is
  taken before each stage so any stage can be reversed.

## 7. Open questions
1. Meta authentication template approval for the login code (blocks
   production go-live of Stage 2/3, not development).
2. Whether `login_codes` should also support a second channel later (SMS);
   not built now.
3. Pricing fallback formula (parked, unrelated to this work).
