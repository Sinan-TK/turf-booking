# Decouple WhatsApp and move booking to the website — Implementation Plan (Stages 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WhatsApp becomes send-only behind a notification port, customers log in on the website with a phone number and a one-time code, the website handles the whole booking journey, and the WhatsApp chat menu is retired.

**Architecture:** A `CustomerMessenger` port (token `CUSTOMER_MESSENGER`) is the only way domain code messages a customer; a WhatsApp adapter implements it. A new `CustomerOtpService` issues hashed, single-use, rate-limited login codes and mints the existing `CustomerSession` cookie. The Next.js customer app gets a login dialog, a checkout page and account pages, and the `/book/[token]` link flow plus the WhatsApp menu state machine are deleted.

**Tech Stack:** NestJS 10, `nestjs-zod`, Prisma 5 (Neon Postgres), Jest + supertest e2e against the dev DB, Next.js 14 + Tailwind, `@nestjs/throttler`, Razorpay.

**Spec:** `docs/superpowers/specs/2026-10-15-clean-architecture-and-web-booking-design.md` (Sections 3–6). This plan covers **Stages 1–4**. Stages 5–9 (module-by-module layering, `bookings` split, lint tightening) get their own plan after Stage 4 is reported and approved.

## Global Constraints

- Dev database only (`neondb` @ `ep-calm-dew-b3u8qxsd`). Before any migration: print the sanitized `DATABASE_URL` host/db and run `prisma migrate status`. Never reset, never delete bookings, payments, refunds or coin records.
- Migrations are additive and SQL is reviewed before applying. `resource_locks.during` and the `no_overlapping_resource_locks` constraint are never touched. Existing tables are not dropped in these stages (the `booking_sessions` table is left in place).
- Existing authentication/authorization behaviour is preserved. Staff login and the `AuthGuard` order (Bearer → origin cookie → customer cookie) are unchanged.
- Business behaviour is unchanged: policy, pricing, lock, refund tiers, 10-minute hold (`SLOT_HOLD_TTL_MINUTES`). Existing e2e specs must pass **unchanged** after Stage 1 (only the specs for deleted features are removed in Stage 4).
- Message wording sent to customers for confirmation/cancellation stays byte-identical in Stage 1.
- Login code rules (from the spec): 6 digits, stored hashed, valid 5 minutes, max 5 attempts per code, resend cooldown 30 s, per-phone limit 5 codes/hour, per-IP throttle, single use. Session is an httpOnly cookie (`customer_session`); `CUSTOMER_SESSION_TTL_HOURS` default becomes `168` (7 days).
- Phone numbers are stored in E.164 with a leading `+` (existing format). A 10-digit input is treated as India (`DEFAULT_COUNTRY_CODE=91`).
- `AUTH_OTP_DELIVERY=log` is development only; `loadEnv()` must throw in production when it is `log`.
- Never run `pnpm build` for an app while that app's dev server is running (they share `.next`). Use `typecheck` + `lint` + tests while dev servers are up; stop servers before a full build.
- No git repository exists: every task ends with a **Checkpoint** (full relevant suite green + source snapshot via robocopy). Use PowerShell for the snapshot command.
- Shell note: write multi-line files with the Write tool, not shell heredocs.

## Review Focus

Input classes the spec implies but no obvious test covers; each is pinned to the owning task below.

1. A phone typed as `98765 43210`, `+91 98765-43210`, `0098765…`, or with letters → one canonical `+91…` value or a 400, never a second customer row. (Task 2)
2. Two simultaneous `verify` calls with the same correct code → exactly one session is created. (Task 5)
3. Requesting a new code while an older one is unexpired → only the newest code works. (Task 4)
4. WhatsApp send fails while requesting a code → 503 and the stored code is unusable; no hint whether the number has an account. (Task 4)
5. Slot hold expires while the customer is on the login screen or checkout → clear "slot no longer held" state, not a payment attempt. (Task 8)
6. Double-click on Pay (Coins or Razorpay) → one payment attempt only. (Task 8)
7. Customer logs in as a different phone mid-journey while a hold exists for the first → the old hold is not shown or payable. (Task 8)

---

## Stage 1 — Foundation (no behaviour change)

### Task 1: `CustomerMessenger` port, WhatsApp adapter, remove WhatsApp imports from bookings/payments/coins

**Files:**
- Create: `apps/api/src/customer-messaging/customer-messenger.port.ts`
- Create: `apps/api/src/customer-messaging/customer-messaging.module.ts`
- Create: `apps/api/src/whatsapp/whatsapp-customer-messenger.ts`
- Create: `apps/api/test/customer-messaging.e2e-spec.ts`
- Modify: `apps/api/src/bookings/bookings.service.ts` (constructor line ~64, `notifyCancellation` ~829–842, import ~21)
- Modify: `apps/api/src/payments/payments.service.ts` (import ~22, constructor ~35, `notifyBookingConfirmed` ~270–277)
- Modify: `apps/api/src/coins/coins.service.ts` (import ~10, constructor ~19, send block ~79–88)
- Modify: `apps/api/src/bookings/bookings.module.ts`, `payments/payments.module.ts`, `coins/coins.module.ts` (swap `WhatsAppClientModule` for `CustomerMessagingModule`)
- Modify: `apps/api/.eslintrc.json` (boundary rule)

**Interfaces:**
- Produces:
  ```ts
  export const CUSTOMER_MESSENGER = Symbol('CUSTOMER_MESSENGER');
  export interface CustomerMessenger {
    bookingConfirmed(toPhone: string, orderId: string): Promise<void>;
    bookingCancelled(toPhone: string, orderId: string, coinsCredited?: string): Promise<void>;
    // added in Task 4: loginCode(toPhone: string, code: string): Promise<void>;
  }
  ```
- Consumes: `WhatsAppClientService.sendText(to: string, body: string): Promise<void>` (existing).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/customer-messaging.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { WhatsAppClientService } from '../src/whatsapp/whatsapp-client.service';
import { WhatsAppCustomerMessenger } from '../src/whatsapp/whatsapp-customer-messenger';

describe('WhatsAppCustomerMessenger', () => {
  const sendText = jest.fn().mockResolvedValue(undefined);
  let messenger: WhatsAppCustomerMessenger;

  beforeEach(async () => {
    sendText.mockClear();
    const mod = await Test.createTestingModule({
      providers: [
        WhatsAppCustomerMessenger,
        { provide: WhatsAppClientService, useValue: { sendText } },
      ],
    }).compile();
    messenger = mod.get(WhatsAppCustomerMessenger);
  });

  it('sends the confirmation text unchanged', async () => {
    await messenger.bookingConfirmed('+919800000001', 'BK0001');
    expect(sendText).toHaveBeenCalledWith(
      '+919800000001',
      '✅ Payment received! Booking BK0001 is confirmed. See you on the venue!',
    );
  });

  it('sends the cancellation text with a coin refund line', async () => {
    await messenger.bookingCancelled('+919800000001', 'BK0001', '250');
    expect(sendText).toHaveBeenCalledWith(
      '+919800000001',
      '✅ Booking BK0001 cancelled.\n🪙 250 Coins credited.',
    );
  });

  it('sends the cancellation text without a refund line when nothing was paid', async () => {
    await messenger.bookingCancelled('+919800000001', 'BK0001');
    expect(sendText).toHaveBeenCalledWith('+919800000001', '✅ Booking BK0001 cancelled.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run (from `apps/api`): `pnpm test -- test/customer-messaging`
Expected: FAIL — `Cannot find module '../src/whatsapp/whatsapp-customer-messenger'`.

- [ ] **Step 3: Create the port**

`apps/api/src/customer-messaging/customer-messenger.port.ts`:

```ts
/**
 * The only way domain/application code talks to a customer outside the
 * website. Implementations know the channel (WhatsApp today); callers
 * never do. Every method must resolve or reject — callers decide whether a
 * failure is fatal (login code) or best-effort (confirmations, via .catch).
 */
export const CUSTOMER_MESSENGER = Symbol('CUSTOMER_MESSENGER');

export interface CustomerMessenger {
  bookingConfirmed(toPhone: string, orderId: string): Promise<void>;
  bookingCancelled(toPhone: string, orderId: string, coinsCredited?: string): Promise<void>;
}
```

- [ ] **Step 4: Create the adapter**

`apps/api/src/whatsapp/whatsapp-customer-messenger.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { WhatsAppClientService } from './whatsapp-client.service';

/** WhatsApp implementation of the CustomerMessenger port. */
@Injectable()
export class WhatsAppCustomerMessenger implements CustomerMessenger {
  constructor(private readonly whatsapp: WhatsAppClientService) {}

  bookingConfirmed(toPhone: string, orderId: string): Promise<void> {
    return this.whatsapp.sendText(
      toPhone,
      `✅ Payment received! Booking ${orderId} is confirmed. See you on the venue!`,
    );
  }

  bookingCancelled(toPhone: string, orderId: string, coinsCredited?: string): Promise<void> {
    const refundLine = coinsCredited ? `\n🪙 ${coinsCredited} Coins credited.` : '';
    return this.whatsapp.sendText(toPhone, `✅ Booking ${orderId} cancelled.${refundLine}`);
  }
}
```

- [ ] **Step 5: Create the module**

`apps/api/src/customer-messaging/customer-messaging.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WhatsAppClientModule } from '../whatsapp/whatsapp-client.module';
import { WhatsAppCustomerMessenger } from '../whatsapp/whatsapp-customer-messenger';
import { CUSTOMER_MESSENGER } from './customer-messenger.port';

/** Wires the port to its WhatsApp adapter. Domain modules import this, never WhatsApp. */
@Module({
  imports: [WhatsAppClientModule],
  providers: [
    WhatsAppCustomerMessenger,
    { provide: CUSTOMER_MESSENGER, useExisting: WhatsAppCustomerMessenger },
  ],
  exports: [CUSTOMER_MESSENGER],
})
export class CustomerMessagingModule {}
```

- [ ] **Step 6: Swap the three call sites**

In `bookings.service.ts`: remove `import { WhatsAppClientService } from '../whatsapp/whatsapp-client.service';`; add
```ts
import { Inject } from '@nestjs/common'; // merge into the existing @nestjs/common import
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
```
Replace the constructor parameter `private readonly whatsapp: WhatsAppClientService,` with
`@Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,`
and replace the body of `notifyCancellation` after the `customer` lookup with:
```ts
    await this.messenger.bookingCancelled(
      customer.whatsappNumber,
      result.booking.orderId,
      result.refund ? result.refund.coinAmountCredited.toString() : undefined,
    );
```
(delete the `refundLine` constant above it).

In `payments.service.ts`: same import swap, constructor `@Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,`, and `notifyBookingConfirmed` body becomes
`await this.messenger.bookingConfirmed(customer.whatsappNumber, orderId);`

In `coins.service.ts`: same import swap and constructor; the block becomes
```ts
    if (customer) {
      await this.messenger
        .bookingConfirmed(customer.whatsappNumber, booking.orderId)
        .catch(() => undefined);
    }
```

In the three modules replace `WhatsAppClientModule` (import line and `imports:` entry) with `CustomerMessagingModule` from `'../customer-messaging/customer-messaging.module'`.

- [ ] **Step 7: Add the boundary lint rule**

Edit `apps/api/.eslintrc.json` to:

```json
{
  "extends": ["../../.eslintrc.json"],
  "rules": {
    "@typescript-eslint/consistent-type-imports": "off"
  },
  "overrides": [
    {
      "files": [
        "src/bookings/**/*.ts",
        "src/payments/**/*.ts",
        "src/coins/**/*.ts",
        "src/venues/**/*.ts",
        "src/availability/**/*.ts"
      ],
      "rules": {
        "no-restricted-imports": [
          "error",
          {
            "patterns": [
              {
                "group": ["**/whatsapp/*", "**/whatsapp"],
                "message": "Domain modules message customers through CUSTOMER_MESSENGER, never WhatsApp directly."
              }
            ]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 8: Run lint, typecheck and the new test**

Run: `pnpm --filter @venue/api lint && pnpm --filter @venue/api typecheck && pnpm --filter @venue/api test -- test/customer-messaging`
Expected: lint clean, typecheck clean, 3 tests PASS.

- [ ] **Step 9: Checkpoint — full suite and snapshot**

Run (from `apps/api`): `pnpm test` — Expected: previous 17 suites + 1 new, all PASS (100+ tests).
Snapshot (PowerShell): `robocopy "D:\ZAS WORKS\turf-booking" "D:\ZAS WORKS\snapshots\stage1" /E /XD node_modules .next dist .turbo /XF *.tsbuildinfo /NFL /NDL /NJH /NJS /NP`
**Stop and report Stage 1 to the user before Stage 2.**

---

## Stage 2 — Customer login (API)

### Task 2: Config, phone normalisation, session TTL

**Files:**
- Modify: `packages/config/src/env.ts`
- Create: `apps/api/src/common/phone.ts`
- Create: `apps/api/test/phone.e2e-spec.ts`
- Modify: `.env.example`, `DEPLOYMENT.md`

**Interfaces:**
- Produces: `normalizePhone(input: string, defaultCountryCode?: string): string | null` returning `+<digits>` or `null`; env keys `AUTH_OTP_DELIVERY: 'whatsapp'|'log'` (default `whatsapp`), `OTP_TTL_MINUTES` (5), `OTP_MAX_ATTEMPTS` (5), `OTP_RESEND_COOLDOWN_SECONDS` (30), `OTP_MAX_CODES_PER_HOUR` (5), `DEFAULT_COUNTRY_CODE` ('91'), `WHATSAPP_OTP_TEMPLATE` (optional).

- [ ] **Step 1: Write the failing test** — `apps/api/test/phone.e2e-spec.ts`:

```ts
import { normalizePhone } from '../src/common/phone';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['00919876543210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
  ])('canonicalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '98765x43210', '+', '1'.repeat(16)])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('honours another default country code for 10-digit numbers', () => {
    expect(normalizePhone('4155550123', '1')).toBe('+14155550123');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @venue/api test -- test/phone` → FAIL (module not found).

- [ ] **Step 3: Implement** — `apps/api/src/common/phone.ts`:

```ts
/**
 * Canonical E.164-style form used for Customer.whatsappNumber: "+" then
 * digits. A bare 10-digit number gets the default country code. Returns
 * null for anything that is not 11–15 digits after cleaning, so two
 * spellings of one phone can never become two customers.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  const cleaned = input.trim().replace(/[\s\-().]/g, '');
  const digits = cleaned.replace(/^\+/, '').replace(/^00/, '');
  if (!/^\d+$/.test(digits)) return null;
  const full = digits.length === 10 ? defaultCountryCode + digits : digits;
  return full.length >= 11 && full.length <= 15 ? `+${full}` : null;
}
```

- [ ] **Step 4: Run to verify pass** — same command → all cases PASS.

- [ ] **Step 5: Add env keys** — in `packages/config/src/env.ts`, next to `CUSTOMER_SESSION_TTL_HOURS` (change its default to 168):

```ts
  CUSTOMER_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),

  // Customer login codes (phone + one-time code). "log" prints the code in
  // the server log instead of sending it — development only.
  AUTH_OTP_DELIVERY: z.enum(['whatsapp', 'log']).default('whatsapp'),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(30),
  OTP_MAX_CODES_PER_HOUR: z.coerce.number().int().positive().default(5),
  DEFAULT_COUNTRY_CODE: z.string().regex(/^\d{1,3}$/).default('91'),
  WHATSAPP_OTP_TEMPLATE: optionalString(z.string().min(1)),
```

and in the existing production validation block (where `AUTH_JWT_SECRET` is checked) add:

```ts
  if (env.NODE_ENV === 'production' && env.AUTH_OTP_DELIVERY === 'log') {
    throw new Error('AUTH_OTP_DELIVERY=log is development only and must not be used in production');
  }
```
(Use the same error-collection style as the surrounding checks; open the file and mirror it.)

- [ ] **Step 6: Document** — add the new keys to `.env.example` (dev value `AUTH_OTP_DELIVERY=log`) and a short "Customer login" bullet to `DEPLOYMENT.md` (production must use `whatsapp` and an approved authentication template).

- [ ] **Step 7: Verify** — `pnpm typecheck` (all packages) PASS.

- [ ] **Step 8: Checkpoint** — `pnpm --filter @venue/api test` all green; snapshot to `...\stage2-task2`.

### Task 3: `login_codes` table (additive migration)

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20261015100000_customer_login_codes/migration.sql`

**Interfaces:** Produces Prisma model `LoginCode { id, phone, codeHash, expiresAt, attempts, consumedAt?, createdAt }` and enum value `CustomerSessionSourceLinkType.LOGIN`.

- [ ] **Step 1: Schema** — add `LOGIN` to `enum CustomerSessionSourceLinkType`, and at the end of the customer section:

```prisma
/// One-time phone login codes for the customer website. The code itself is
/// never stored — only an HMAC of (phone, code). Single use via consumedAt.
model LoginCode {
  id         String    @id @default(uuid()) @db.Uuid
  phone      String
  codeHash   String
  attempts   Int       @default(0)
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([phone, createdAt])
  @@map("login_codes")
}
```

- [ ] **Step 2: Hand-write and review the SQL** — `migration.sql`:

```sql
-- Additive only: one new enum value, one new table.
ALTER TYPE "CustomerSessionSourceLinkType" ADD VALUE IF NOT EXISTS 'LOGIN';

CREATE TABLE "login_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_codes_phone_createdAt_idx" ON "login_codes"("phone", "createdAt");
```

- [ ] **Step 3: Confirm the target** — from `packages/database`: `npx prisma migrate status`. Expected: datasource `neondb` at `ep-calm-dew-b3u8qxsd`, exactly one pending migration (this one). **If the host differs, stop.**

- [ ] **Step 4: Apply and generate** — `npx prisma migrate deploy` then `pnpm db:generate` (stop dev servers first if `EPERM` on the engine DLL).

- [ ] **Step 5: Verify no drift** — `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
Expected: only the pre-existing `DROP COLUMN "during"` lines for `inventory_reservations` and `resource_locks` (raw-SQL columns Prisma does not model). Anything about `login_codes` or the enum = fix before continuing.

- [ ] **Step 6: Verify invariants** — row counts of `bookings`, `payments`, `refunds`, `resource_locks`, `coin_transactions`, `audit_logs` unchanged; `no_overlapping_resource_locks` still present.

- [ ] **Step 7: Checkpoint** — `pnpm typecheck`; full API suite green; snapshot.

### Task 4: `CustomerOtpService` + `loginCode` on the messenger + test fake

**Files:**
- Modify: `apps/api/src/customer-messaging/customer-messenger.port.ts` (add `loginCode`)
- Modify: `apps/api/src/whatsapp/whatsapp-customer-messenger.ts`
- Create: `apps/api/src/auth/customer-otp.service.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Modify: `apps/api/test/setup/test-app.ts`
- Create: `apps/api/test/customer-otp.e2e-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // port
  loginCode(toPhone: string, code: string): Promise<void>;
  // service
  class CustomerOtpService {
    requestCode(rawPhone: string): Promise<{ resendAfterSeconds: number; expiresInSeconds: number }>;
    verifyCode(rawPhone: string, code: string): Promise<{
      rawToken: string;
      customer: { id: string; name: string | null; phone: string };
      needsName: boolean;
    }>;
  }
  // test fake (exported from test/setup/test-app.ts)
  export class FakeCustomerMessenger implements CustomerMessenger {
    codes: Array<{ phone: string; code: string }>;
    failNext: boolean;
    lastCodeFor(phone: string): string | undefined;
  }
  ```
- Consumes: `normalizePhone` (Task 2), `LoginCode` model (Task 3), `CustomersService.findOrCreateByWhatsAppNumber`, `CustomerSessionService.createSession(customerId, 'LOGIN')`, `constantTimeEquals` from `@venue/shared`.

- [ ] **Step 1: Add `loginCode` to the port and adapter.**

Port: add `loginCode(toPhone: string, code: string): Promise<void>;`.
Adapter (add imports `Logger` and `loadEnv`):

```ts
  private readonly logger = new Logger(WhatsAppCustomerMessenger.name);

  async loginCode(toPhone: string, code: string): Promise<void> {
    const env = loadEnv();
    if (env.AUTH_OTP_DELIVERY === 'log') {
      this.logger.warn(`[DEV ONLY] login code for ${toPhone}: ${code}`);
      return;
    }
    if (env.WHATSAPP_OTP_TEMPLATE) {
      return this.whatsapp.sendTemplate(toPhone, env.WHATSAPP_OTP_TEMPLATE, 'en', [code]);
    }
    return this.whatsapp.sendText(
      toPhone,
      `Your Venue Booking login code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Do not share it.`,
    );
  }
```

- [ ] **Step 2: Add the test fake and override it for every spec** — in `test/setup/test-app.ts`:

```ts
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../../src/customer-messaging/customer-messenger.port';

export class FakeCustomerMessenger implements CustomerMessenger {
  codes: Array<{ phone: string; code: string }> = [];
  failNext = false;
  async bookingConfirmed() {}
  async bookingCancelled() {}
  async loginCode(phone: string, code: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('send failed');
    }
    this.codes.push({ phone, code });
  }
  lastCodeFor(phone: string) {
    return [...this.codes].reverse().find((c) => c.phone === phone)?.code;
  }
}
```
and in `createTestApp()` add `.overrideProvider(CUSTOMER_MESSENGER).useValue(new FakeCustomerMessenger())` before `.compile()`.

- [ ] **Step 3: Write the failing tests** — `test/customer-otp.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';
import { CustomerOtpService } from '../src/auth/customer-otp.service';
import { prisma } from './setup/fixtures';

describe('CustomerOtpService', () => {
  let app: INestApplication;
  let otp: CustomerOtpService;
  let messenger: FakeCustomerMessenger;
  const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  beforeAll(async () => {
    app = await createTestApp();
    otp = app.get(CustomerOtpService);
    messenger = app.get(CUSTOMER_MESSENGER);
  });
  afterAll(async () => app.close());

  it('issues a 6-digit code and logs a customer in with it', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    expect(code).toMatch(/^\d{6}$/);
    const res = await otp.verifyCode(p, code);
    expect(res.customer.phone).toBe(p);
    expect(res.needsName).toBe(true);
    expect(res.rawToken.length).toBeGreaterThan(20);
  });

  it('never stores the code in plain text', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    const row = await prisma.loginCode.findFirstOrThrow({ where: { phone: p } });
    expect(row.codeHash).not.toContain(code);
  });

  it('rejects a wrong code and locks the code after 5 attempts', async () => {
    const p = phone();
    await otp.requestCode(p);
    const good = messenger.lastCodeFor(p)!;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(otp.verifyCode(p, bad)).rejects.toThrow();
    }
    await expect(otp.verifyCode(p, good)).rejects.toThrow(/Too many attempts|Invalid or expired/);
  });

  it('is single use', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    await otp.verifyCode(p, code);
    await expect(otp.verifyCode(p, code)).rejects.toThrow();
  });

  it('rejects an expired code', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    await prisma.loginCode.updateMany({ where: { phone: p }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(otp.verifyCode(p, code)).rejects.toThrow();
  });

  it('only the newest code works when a second is requested', async () => {
    const p = phone();
    await otp.requestCode(p);
    const first = messenger.lastCodeFor(p)!;
    await prisma.loginCode.updateMany({ where: { phone: p }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await otp.requestCode(p);
    const second = messenger.lastCodeFor(p)!;
    if (first !== second) await expect(otp.verifyCode(p, first)).rejects.toThrow();
    await expect(otp.verifyCode(p, second)).resolves.toBeDefined();
  });

  it('enforces the resend cooldown', async () => {
    const p = phone();
    await otp.requestCode(p);
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 429 });
  });

  it('caps codes per phone per hour', async () => {
    const p = phone();
    for (let i = 0; i < 5; i++) {
      await otp.requestCode(p);
      await prisma.loginCode.updateMany({ where: { phone: p }, data: { createdAt: new Date(Date.now() - 120_000) } });
    }
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 429 });
  });

  it('returns 503 and leaves no usable code when sending fails', async () => {
    const p = phone();
    messenger.failNext = true;
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 503 });
    const live = await prisma.loginCode.count({ where: { phone: p, consumedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects malformed phones with 400', async () => {
    await expect(otp.requestCode('abc')).rejects.toMatchObject({ status: 400 });
  });

  it('two simultaneous verifies of one code create exactly one session', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    const results = await Promise.allSettled([otp.verifyCode(p, code), otp.verifyCode(p, code)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('reuses the same customer for different spellings of one phone', async () => {
    const digits = `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    await otp.requestCode(digits);
    const a = await otp.verifyCode(digits, messenger.lastCodeFor(`+91${digits}`)!);
    await prisma.loginCode.updateMany({ where: { phone: `+91${digits}` }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await otp.requestCode(`+91 ${digits}`);
    const b = await otp.verifyCode(`+91 ${digits}`, messenger.lastCodeFor(`+91${digits}`)!);
    expect(b.customer.id).toBe(a.customer.id);
  });
});
```

- [ ] **Step 4: Run to verify failure** — `pnpm --filter @venue/api test -- test/customer-otp` → FAIL (service missing).

- [ ] **Step 5: Implement** — `apps/api/src/auth/customer-otp.service.ts`:

```ts
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { loadEnv } from '@venue/config';
import { constantTimeEquals } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerSessionService } from './customer-session.service';
import { CUSTOMER_MESSENGER, type CustomerMessenger } from '../customer-messaging/customer-messenger.port';
import { normalizePhone } from '../common/phone';

const INVALID = 'Invalid or expired code';

@Injectable()
export class CustomerOtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly sessions: CustomerSessionService,
    @Inject(CUSTOMER_MESSENGER) private readonly messenger: CustomerMessenger,
  ) {}

  private hash(phone: string, code: string): string {
    return createHmac('sha256', loadEnv().CUSTOMER_SESSION_SECRET).update(`${phone}:${code}`).digest('hex');
  }

  private phoneOrThrow(raw: string): string {
    const phone = normalizePhone(raw, loadEnv().DEFAULT_COUNTRY_CODE);
    if (!phone) throw new BadRequestException('Enter a valid phone number');
    return phone;
  }

  async requestCode(rawPhone: string) {
    const env = loadEnv();
    const phone = this.phoneOrThrow(rawPhone);
    const now = new Date();

    const recent = await this.prisma.client.loginCode.findMany({
      where: { phone, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent.length >= env.OTP_MAX_CODES_PER_HOUR) {
      throw new HttpException('Too many codes requested. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const last = recent[0];
    if (last && now.getTime() - last.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new HttpException(
        `Please wait ${env.OTP_RESEND_COOLDOWN_SECONDS} seconds before requesting another code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.client.$transaction([
      this.prisma.client.loginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: now } }),
      this.prisma.client.loginCode.create({
        data: { phone, codeHash: this.hash(phone, code), expiresAt: new Date(now.getTime() + env.OTP_TTL_MINUTES * 60_000) },
      }),
    ]);

    try {
      await this.messenger.loginCode(phone, code);
    } catch {
      await this.prisma.client.loginCode.updateMany({ where: { phone, consumedAt: null }, data: { consumedAt: new Date() } });
      throw new ServiceUnavailableException('Could not send the code. Please try again.');
    }
    return { resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS, expiresInSeconds: env.OTP_TTL_MINUTES * 60 };
  }

  async verifyCode(rawPhone: string, code: string) {
    const env = loadEnv();
    const phone = this.phoneOrThrow(rawPhone);
    const now = new Date();

    const latest = await this.prisma.client.loginCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw new UnauthorizedException(INVALID);

    // Count the attempt before comparing, atomically, so parallel guesses
    // cannot exceed the limit.
    const counted = await this.prisma.client.loginCode.update({
      where: { id: latest.id },
      data: { attempts: { increment: 1 } },
    });
    if (counted.attempts > env.OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Too many attempts. Request a new code.');
    }
    if (!constantTimeEquals(latest.codeHash, this.hash(phone, code))) {
      throw new UnauthorizedException(INVALID);
    }

    // Single-use claim: only one concurrent verify can flip consumedAt.
    const claimed = await this.prisma.client.loginCode.updateMany({
      where: { id: latest.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new UnauthorizedException(INVALID);

    const customer = await this.customers.findOrCreateByWhatsAppNumber(phone);
    const { rawToken } = await this.sessions.createSession(customer.id, 'LOGIN');
    return {
      rawToken,
      customer: { id: customer.id, name: customer.name, phone: customer.whatsappNumber },
      needsName: !customer.name,
    };
  }
}
```

- [ ] **Step 6: Register** — in `auth.module.ts` add `imports: [IdentityModule, CustomersModule, CustomerMessagingModule]` and `CustomerOtpService` to `providers` and `exports`.

- [ ] **Step 7: Run to verify pass** — `pnpm --filter @venue/api test -- test/customer-otp` → all PASS. If `constantTimeEquals` throws on unequal lengths, both hashes are 64-char hex so lengths always match.

- [ ] **Step 8: Checkpoint** — typecheck, lint, full API suite green; snapshot.

### Task 5: `CustomerAuthController` (request, verify, logout, me)

**Files:**
- Create: `apps/api/src/auth/dto/customer-auth.dto.ts`
- Create: `apps/api/src/auth/customer-auth.controller.ts`
- Modify: `apps/api/src/auth/auth.module.ts`
- Create: `apps/api/test/customer-auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `CustomerOtpService`, `CustomerSessionService.revokeSession`, `CustomersService.updateName`, `CUSTOMER_SESSION_COOKIE`, `CUSTOMER_SESSION_COOKIE_OPTIONS()`.
- Produces (routes; prefix `customer-auth` to avoid the staff `:portal` routes):
  - `POST /customer-auth/request-code` `{ phone }` → `200 { resendAfterSeconds, expiresInSeconds }`
  - `POST /customer-auth/verify` `{ phone, code }` → `200 { customer: {id,name,phone}, needsName }` + `Set-Cookie: customer_session`
  - `POST /customer-auth/logout` → `200 { ok: true }`, cookie cleared, session revoked
  - `GET /customer-auth/me` (CUSTOMER) → `{ id, name, phone }`
  - `PATCH /customer-auth/me` `{ name }` (CUSTOMER) → `{ id, name, phone }`

- [ ] **Step 1: DTOs** — `dto/customer-auth.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestCodeSchema = z.object({ phone: z.string().min(1).max(30) });
export class RequestCodeDto extends createZodDto(requestCodeSchema) {}

export const verifyCodeSchema = z.object({
  phone: z.string().min(1).max(30),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export class VerifyCodeDto extends createZodDto(verifyCodeSchema) {}

export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(80) });
export class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
```

- [ ] **Step 2: Write the failing tests** — `test/customer-auth.e2e-spec.ts` (own app instance so the throttle counters are isolated, same reason as the staff specs):

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';
import { CUSTOMER_SESSION_COOKIE } from '../src/auth/auth.constants';

describe('customer auth (HTTP)', () => {
  let app: INestApplication;
  let messenger: FakeCustomerMessenger;
  const phone = () => `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) => c.startsWith(`${CUSTOMER_SESSION_COOKIE}=`));

  beforeAll(async () => {
    app = await createTestApp();
    messenger = app.get(CUSTOMER_MESSENGER);
  });
  afterAll(async () => app.close());

  it('full login: request, verify, me, set name, logout', async () => {
    const p = phone();
    const server = app.getHttpServer();
    await request(server).post('/customer-auth/request-code').send({ phone: p }).expect(200);
    const code = messenger.lastCodeFor(`+91${p}`)!;

    const verify = await request(server).post('/customer-auth/verify').send({ phone: p, code }).expect(200);
    expect(verify.body.needsName).toBe(true);
    const cookie = cookieOf(verify)!;
    expect(cookie).toMatch(/HttpOnly/i);

    const agent = request.agent(server);
    const me = await agent.get('/customer-auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.phone).toBe(`+91${p}`);

    await agent.patch('/customer-auth/me').set('Cookie', cookie).send({ name: 'Asha' }).expect(200);
    const again = await agent.get('/customer-auth/me').set('Cookie', cookie).expect(200);
    expect(again.body.name).toBe('Asha');

    await agent.post('/customer-auth/logout').set('Cookie', cookie).expect(200);
    await agent.get('/customer-auth/me').set('Cookie', cookie).expect(401);
  });

  it('a wrong code sets no cookie', async () => {
    const p = phone();
    const server = app.getHttpServer();
    await request(server).post('/customer-auth/request-code').send({ phone: p }).expect(200);
    const res = await request(server).post('/customer-auth/verify').send({ phone: p, code: '000001' });
    expect([401]).toContain(res.status);
    expect(cookieOf(res)).toBeUndefined();
  });

  it('rejects a non-numeric code with 400', async () => {
    await request(app.getHttpServer()).post('/customer-auth/verify').send({ phone: phone(), code: 'abcdef' }).expect(400);
  });

  it('me requires a customer session', async () => {
    await request(app.getHttpServer()).get('/customer-auth/me').expect(401);
  });

  it('throttles request-code per IP', async () => {
    const server = app.getHttpServer();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await request(server).post('/customer-auth/request-code').send({ phone: phone() })).status);
    }
    expect(statuses).toContain(429);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm --filter @venue/api test -- test/customer-auth` → FAIL (404s / missing controller).

- [ ] **Step 4: Implement** — `customer-auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { CustomerOtpService } from './customer-otp.service';
import { CustomerSessionService } from './customer-session.service';
import { CustomersService } from '../customers/customers.service';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthContext } from './auth.types';
import { CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE_OPTIONS } from './auth.constants';
import { RequestCodeDto, UpdateProfileDto, VerifyCodeDto } from './dto/customer-auth.dto';

@Controller('customer-auth')
export class CustomerAuthController {
  constructor(
    private readonly otp: CustomerOtpService,
    private readonly sessions: CustomerSessionService,
    private readonly customers: CustomersService,
  ) {}

  @Post('request-code')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestCode(@Body() dto: RequestCodeDto) {
    return this.otp.requestCode(dto.phone);
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyCodeDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.otp.verifyCode(dto.phone, dto.code);
    res.cookie(CUSTOMER_SESSION_COOKIE, result.rawToken, {
      ...CUSTOMER_SESSION_COOKIE_OPTIONS(),
      maxAge: loadEnv().CUSTOMER_SESSION_TTL_HOURS * 3_600_000,
    });
    return { customer: result.customer, needsName: result.needsName };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[CUSTOMER_SESSION_COOKIE];
    if (raw) await this.sessions.revokeSession(raw);
    res.clearCookie(CUSTOMER_SESSION_COOKIE, CUSTOMER_SESSION_COOKIE_OPTIONS());
    return { ok: true };
  }

  @Get('me')
  @Roles(Role.CUSTOMER)
  async me(@CurrentUser() actor: AuthContext) {
    const c = await this.customers.getForAdmin(actor.id);
    return { id: c.id, name: c.name, phone: c.whatsappNumber };
  }

  @Patch('me')
  @Roles(Role.CUSTOMER)
  async updateMe(@CurrentUser() actor: AuthContext, @Body() dto: UpdateProfileDto) {
    const c = await this.customers.updateName(actor.id, dto.name);
    return { id: c.id, name: c.name, phone: c.whatsappNumber };
  }
}
```
(Check the exact decorator import names in `auth/decorators/*.ts` and match them; the staff controller shows the style.) Register `CustomerAuthController` in `auth.module.ts` `controllers`.

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @venue/api test -- test/customer-auth` → PASS.

- [ ] **Step 6: CORS check** — confirm `main.ts` allows credentials for the web origin on the new routes (same `enableCors` as other cookie routes). No change expected.

- [ ] **Step 7: Checkpoint** — typecheck, lint, `typecheck:e2e`, full suite green; snapshot. **Stop and report Stage 2 to the user before Stage 3.**

---

## Stage 3 — Customer website

> Reuse before writing: the existing `app/page.tsx` search/results/modal, `app/book/[token]/page.tsx` (hold → pay logic), `app/bookings/page.tsx`, `app/bookings/[id]/page.tsx`, `components/ui.tsx`, `lib/api.ts`. Keep the responsive layout rules already in place (`max-w-screen-xl` containers, `md:` breakpoints). Verify at 390, 768, 1280 px.

### Task 6: Customer session context and login dialog

**Files:**
- Create: `apps/web/lib/customer.tsx`
- Create: `apps/web/components/login-dialog.tsx`
- Modify: `apps/web/app/layout.tsx` (wrap children in `CustomerProvider`)
- Modify: `apps/web/lib/api.ts` (add `patch`)

**Interfaces:**
- Produces:
  ```ts
  interface Customer { id: string; name: string | null; phone: string }
  function useCustomer(): {
    customer: Customer | null; loading: boolean;
    requireLogin(): Promise<Customer>;   // opens dialog if logged out; resolves after login, rejects if dismissed
    logout(): Promise<void>;
    refresh(): Promise<void>;
  }
  ```

- [ ] **Step 1:** Add `patch: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: ... })` to `lib/api.ts` (mirror `post`).
- [ ] **Step 2:** `lib/customer.tsx` — a context provider that on mount calls `api.get<Customer>('/customer-auth/me')` (treat 401 as logged-out), exposes the interface above, and renders `<LoginDialog>` when `requireLogin()` is pending. `requireLogin` returns a promise stored in a ref with `resolve/reject`; dismissing the dialog rejects with `new Error('dismissed')`.
- [ ] **Step 3:** `components/login-dialog.tsx` — three steps in one modal:
  1. phone input (autofocus, `inputMode="tel"`, "Send code" button, shows server message on 400/429/503);
  2. 6-digit code input (`inputMode="numeric"`, `autoComplete="one-time-code"`, resend button disabled for `resendAfterSeconds` with a visible countdown, "Change number" link);
  3. only if `needsName`: name input → `PATCH /customer-auth/me`.
  On success call the provider's `onLoggedIn(customer)`. Escape and backdrop dismiss. Trap focus within the dialog; announce errors with `role="alert"`. Use the existing `ui.tsx` `Input`/button styles.
- [ ] **Step 4: Verify** — `pnpm --filter @venue/web typecheck && pnpm --filter @venue/web lint`. Manual (dev, `AUTH_OTP_DELIVERY=log`): trigger `requireLogin()` from a temporary button on the home page, complete the flow using the code printed in the API log, confirm `customer_session` cookie is httpOnly in devtools, reload and stay logged in, then remove the temporary button.
- [ ] **Step 5: Checkpoint** — snapshot.

### Task 7: Book from the search results (replace the WhatsApp hand-off)

**Files:**
- Modify: `apps/web/app/page.tsx` (WhatsApp helpers ~147–170, modal footer ~847–990, mobile slot chips ~1252–1270, header WhatsApp icon ~462, generic inquiry links ~425/1015)

- [ ] **Step 1:** Delete `WHATSAPP_NUMBER`, `whatsappLink`, `bookSlotIntentText`, `generalWhatsappLink`, `generalLink`, the `WhatsAppIcon` header link and every `wa.me` anchor. Remove `WhatsAppIcon` from the import.
- [ ] **Step 2:** Add a single handler used by the modal's confirm button and the card slot chips:

```ts
async function bookSlot(resourceId: string, startTime: string, durationMinutes: number) {
  setBooking(true);
  setBookError(null);
  try {
    await requireLogin(); // may open the login dialog; rejects if dismissed
    const hold = await api.post<{ id: string }>('/bookings/hold', { resourceId, startTime, durationMinutes });
    router.push(`/checkout/${hold.id}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'dismissed') return;
    setBookError(err instanceof ApiError ? err.message : 'Could not hold that slot. Please try another.');
  } finally {
    setBooking(false);
  }
}
```
(`useRouter` from `next/navigation`; `useCustomer()` for `requireLogin`.)
- [ ] **Step 3:** Modal primary button label: `Book {time}` with a spinner while `booking`; disabled until a slot is selected; show `bookError` in an `ErrorBanner`. Remove the "WhatsApp booking is not configured" message.
- [ ] **Step 4: Verify** — typecheck + lint. Manual: logged out → pick slot → login dialog → after login the hold is created and the browser lands on `/checkout/<id>`; a taken slot shows the server's 409 message without leaving the modal.
- [ ] **Step 5: Checkpoint** — snapshot.

### Task 8: Checkout page (hold countdown, pay, confirmation)

**Files:**
- Create: `apps/web/app/checkout/[bookingId]/page.tsx`
- Create: `apps/web/lib/checkout.ts` (the moved helpers)
- Modify: `apps/web/lib/customer.tsx` (expose `customer.id` for the ownership check below)

**Interfaces:** Consumes `GET /me/bookings/:id`, `GET /me/coins`, `POST /bookings/:id/pay-with-coins`, `POST /payments/create-order`, `POST /payments/verify`, `POST /me/bookings/:id/cancel` (all existing).

- [ ] **Step 1:** Move verbatim from `app/book/[token]/page.tsx` into `lib/checkout.ts`: `formatCountdown` (lines ~114–118), `useCountdown` (~87–112), `formatTimeRange` (~65–85) and the Razorpay script loader/types it already uses. Export them.
- [ ] **Step 2:** The page: `const { customer, requireLogin } = useCustomer()`; load the booking with `api.get('/me/bookings/' + bookingId)`. States:
  - **loading**; **not logged in** → open `requireLogin()` then reload; **404/403 or a booking not owned by this customer** → "We couldn't find that booking" with a link home (never render another customer's data — the API already scopes `/me/bookings`, this covers the stale-state case after switching accounts);
  - **PENDING_PAYMENT + hold active** → summary card (venue, unit, time range, amount), countdown, two pay buttons (Razorpay, Coins with balance and disabled when insufficient);
  - **hold expired / status CANCELLED** → "This slot is no longer held" with a "Choose another time" link; **no pay buttons render**;
  - **CONFIRMED** → confirmation card with order id, time, venue address, links to `/bookings/[id]` and home.
- [ ] **Step 3:** Port `onPayWithCoins`, `pollForConfirmation`, `onPayWithRazorpay` from `book/[token]/page.tsx` (~335–440) verbatim, then add a single in-flight guard so a double click can never start two attempts:

```ts
const payingRef = useRef(false);
async function guarded(fn: () => Promise<void>) {
  if (payingRef.current) return;
  payingRef.current = true;
  setPaying(true);
  try { await fn(); } finally { payingRef.current = false; setPaying(false); }
}
```
and call `guarded(onPayWithCoins)` / `guarded(onPayWithRazorpay)` from the buttons (both disabled while `paying`).
- [ ] **Step 4:** When the countdown reaches 0 call the same refetch used for polling so the page flips to the expired state without a reload.
- [ ] **Step 5: Verify** — typecheck + lint. Manual: (a) hold, wait for expiry (set `SLOT_HOLD_TTL_MINUTES=1` locally) → expired state, no pay buttons; (b) double-click Pay with Coins → one `POST …/pay-with-coins` in the network tab; (c) log out and log in as a different phone, open the old `/checkout/<id>` → "couldn't find that booking"; (d) Razorpay test card flow reaches Confirmed.
- [ ] **Step 6: Checkpoint** — snapshot.

### Task 9: Account pages and login-aware existing pages

**Files:**
- Modify: `apps/web/app/bookings/page.tsx`, `apps/web/app/bookings/[id]/page.tsx`
- Create: `apps/web/app/account/page.tsx` (profile + Coins wallet + transactions)
- Create: `apps/web/app/support/page.tsx` (list + raise ticket)

**Interfaces:** Consumes existing `GET /me/bookings`, `POST /me/bookings/:id/cancel`, `GET /me/coins`, `GET /me/coins/transactions`, `GET/POST /me/support-tickets`, `PATCH /customer-auth/me`.

- [ ] **Step 1:** In `bookings/page.tsx` and `bookings/[id]/page.tsx` replace the "open your booking link from WhatsApp" 401 message with a logged-out state that calls `requireLogin()` and reloads on success. Keep the existing cancel/refund-preview behaviour.
- [ ] **Step 2:** `account/page.tsx`: shows name (editable via `PATCH /customer-auth/me`), phone (read-only), Coins balance and the last 20 transactions.
- [ ] **Step 3:** `support/page.tsx`: ticket list and a form with the same five categories the WhatsApp menu offered (`REFUND_ISSUE`, `PAID_BUT_BOOKING_FAILED`, `BOOKING_ISSUE`, `ACCOUNT_PROFILE_ISSUE`, `OTHER`) posting to `/me/support-tickets`; read the DTO in `apps/api/src/support/dto` first and send exactly its fields.
- [ ] **Step 4: Verify** — typecheck + lint; manual: each page works logged in and prompts for login when logged out.
- [ ] **Step 5: Checkpoint** — snapshot.

### Task 10: Header account menu and responsive pass

**Files:**
- Modify: `apps/web/app/page.tsx` (header), `apps/web/components/ui.tsx` (shared `AccountMenu`)

- [ ] **Step 1:** `AccountMenu`: logged out → "Log in" button (calls `requireLogin()`); logged in → avatar button with the customer's initial opening a menu: My bookings, Wallet (Coins), Saved venues (if a page exists, otherwise omit), Support, Log out. Keyboard accessible (Esc closes, arrow keys optional).
- [ ] **Step 2:** Place it where the removed WhatsApp icon was (header right on all widths). Add the same menu to `Screen` headers on `/bookings`, `/account`, `/support`, `/checkout`.
- [ ] **Step 3: Verify** — resize to 390 / 768 / 1280 px: no horizontal scroll, menu fits on a phone, login dialog usable on a phone keyboard.
- [ ] **Step 4: Checkpoint** — snapshot.

### Task 11: Retire `/book/[token]`

**Files:**
- Delete: `apps/web/app/book/[token]/page.tsx` (and the empty `book` folder)
- Create: `apps/web/app/book/[token]/page.tsx` replacement is **not** created; use `next.config` redirect instead
- Modify: `apps/web/next.config.mjs`

- [ ] **Step 1:** Add to `next.config.mjs`: `async redirects() { return [{ source: '/book/:token', destination: '/', permanent: false }]; }` so old WhatsApp links land on the home search instead of a 404.
- [ ] **Step 2:** Delete the page file. Search the web app for any remaining reference to `/book/` or `booking-sessions` (`grep -rn "booking-sessions\|/book/" apps/web`) and remove it.
- [ ] **Step 3: Verify** — `pnpm --filter @venue/web typecheck && lint`; visit `/book/anything` → redirected home. Stop the web dev server, run `pnpm --filter @venue/web build` (must pass), restart the server.
- [ ] **Step 4: Checkpoint** — snapshot. **Stop and report Stage 3 to the user (include screenshots or a request that they check 390/768/1280 px, since no browser tool is available) before Stage 4.**

---

## Stage 4 — Retire WhatsApp booking

### Task 12: Webhook becomes auto-reply only

**Files:**
- Modify: `apps/api/src/whatsapp/whatsapp-webhook.service.ts`, `whatsapp.module.ts`
- Delete: `whatsapp-menu.service.ts`, `whatsapp-session.service.ts`
- Delete specs: `test/whatsapp-book-intent.e2e-spec.ts`, `test/whatsapp-onboarding.e2e-spec.ts`
- Create: `apps/api/test/whatsapp-autoreply.e2e-spec.ts`

- [ ] **Step 1: Write the failing test** — signed webhook payload (use the signing helper the deleted specs used; copy it into the new spec before deleting them) with an inbound text message; assert `sendText` is called once with the website notice and that sending the same message id twice replies once (dedupe). Fake `WhatsAppClientService.sendText` via `overrideProvider`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — in the webhook service keep: signature verification (fail-closed in production), verify-token GET handshake, payload parsing, message-id dedupe (move from Redis to a small in-memory TTL map or a DB unique key if the old code used Redis — read the current dedupe first and preserve its semantics), and replace the call into `menu.handleInboundMessage(...)` with one reply per sender per 10 minutes:
  `"Hi! Bookings are now made on our website: <WEB_APP_URL>. Open the site, search your venue and book in a few taps."` Add `WEB_APP_URL` to env if no suitable customer-site URL variable exists (check `env.ts`).
- [ ] **Step 4:** Remove `WhatsAppMenuService`/`WhatsAppSessionService` providers and the modules they alone required (`SavedVenuesModule`, `BookingSessionsModule`, `BookingsModule`, `PoliciesModule`, `SupportModule`, `CustomersModule` imports from `WhatsAppModule` if nothing else there uses them).
- [ ] **Step 5: Run** the new spec plus typecheck/lint → PASS.
- [ ] **Step 6: Checkpoint** — full suite; snapshot.

### Task 13: Remove booking-sessions and Redis

**Files:**
- Delete: `apps/api/src/booking-sessions/` (controller, service, module), `test/booking-session-handoff.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`, `packages/config/src/env.ts` (remove `REDIS_URL`, `BOOKING_SESSION_TTL_MINUTES`), `.env.example`, `docker-compose.yml` (remove the redis service if present), `DEPLOYMENT.md` (drop "Redis is required"), `ARCHITECTURE.md` (mark the WhatsApp menu and booking-session sections as retired and describe the new login)
- Keep: the `booking_sessions` table and Prisma model (a later, reviewed migration can drop them; no destructive SQL in this stage)

- [ ] **Step 1:** Delete the module and spec; remove it from `AppModule`. `grep -rn "BookingSession\|booking-sessions" apps/api/src apps/api/test` must show only the Prisma enum/model usage.
- [ ] **Step 2:** Remove `ioredis` (and any Redis client) from `apps/api/package.json` if it is no longer imported anywhere (`grep -rn "ioredis" apps/api/src` first); run `pnpm install`.
- [ ] **Step 3:** Clean env/docs as listed. `loadEnv()` must still validate in tests.
- [ ] **Step 4: Verify** — `pnpm typecheck`, `pnpm lint`, `typecheck:e2e`, full API suite (expect 17 − 3 deleted + 4 new spec files).
- [ ] **Step 5:** Stop all dev servers, run `pnpm build` (all apps), restart servers.
- [ ] **Step 6: Checkpoint** — snapshot.

### Task 14: Stage 4 report

- [ ] **Step 1:** Run the verification list one more time and capture results: typecheck, lint, builds, e2e count, `prisma migrate status` clean, row-count and constraint check from Task 3 Step 6.
- [ ] **Step 2:** Write the report to the user: what was removed, what the customer journey is now, how to run locally (`AUTH_OTP_DELIVERY=log`), the pending Meta template requirement, the left-over `booking_sessions` table, and the proposal for the Stages 5–9 plan.
- [ ] **Step 3:** **Stop.** Stages 5–9 are planned separately only after the user approves this report.

---

## Self-review (spec coverage)

- Spec §3 rules 1–5: rule 4 (notification port) → Task 1, enforced for the modules that used WhatsApp. Rules 1–3 and 5 and the full boundary check are Stages 5–9 (separate plan, as stated at the top).
- Spec §4 journey: browse (unchanged), login (Tasks 4–6), hold/pay/confirm (Tasks 7–8), account (Task 9), auto-reply (Task 12).
- Spec login rules: all six constraints are in Task 4 code and tests (6 digits, hashed, 5 min, attempts, cooldown, hourly cap, single use) plus per-IP throttle in Task 5.
- Spec §5 stages 1–4 map to Tasks 1, 2–5, 6–11, 12–14.
- Spec §6 safety: constraints repeated in Global Constraints; migration review in Task 3; snapshots at every checkpoint.
- Type consistency: `CustomerMessenger` methods (`bookingConfirmed`, `bookingCancelled`, `loginCode`), `CUSTOMER_MESSENGER`, `CustomerOtpService.requestCode/verifyCode`, route prefix `customer-auth`, enum value `LOGIN`, env keys — names are identical across tasks.
- Known judgment calls to confirm at execution: exact decorator/import names in `auth/decorators` (Task 5), the support-ticket DTO fields (Task 9), how the old webhook deduped messages (Task 12), whether `ioredis` is imported elsewhere (Task 13). Each of those tasks begins by reading the code in question.
