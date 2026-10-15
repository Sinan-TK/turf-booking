import { z } from 'zod';

/**
 * An optional env var whose absence is represented by an empty string in
 * .env files (as opposed to the line being omitted entirely) — without
 * this, `z.string().min(1).optional()` rejects "" instead of treating it
 * as unset, since optional() only skips validation when the key is
 * `undefined`, not when it's an empty string.
 */
function optionalString(schema: z.ZodString) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/**
 * Single source of truth for backend environment variables.
 * Fails fast at boot (see loadEnv) instead of surfacing missing-config
 * errors deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Admin/Owner auth — self-hosted: this API verifies passwords, issues
  // short-lived HS256 access JWTs and rotating refresh tokens (httpOnly
  // cookies), and emails invite / password-reset links.
  AUTH_JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),
  RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  // Transactional email (Resend). When RESEND_API_KEY is unset the mail
  // service logs the message (incl. the link) instead of sending —
  // dev/test only; production should always set it.
  RESEND_API_KEY: optionalString(z.string().min(1)),
  MAIL_FROM: z.string().default('Venue Booking <onboarding@resend.dev>'),

  // Where opening hours / blackouts are read from. "rules" = AvailabilityRule
  // + BlockedPeriod (the P3 tables; hours fall back to legacy OperatingHours
  // for a venue that has no rules yet). "legacy" = the old OperatingHours +
  // BlockedDate tables only — the rollback switch. Writes always go to both.
  AVAILABILITY_SOURCE: z.enum(['rules', 'legacy']).default('rules'),

  // Customer server-side sessions
  CUSTOMER_SESSION_SECRET: z.string().min(32),
  CUSTOMER_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(6),

  // BookingSession / SlotHold durations (minutes) — configurable, not hardcoded
  BOOKING_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(20),
  SLOT_HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  PAYMENT_GRACE_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),

  // Razorpay
  RAZORPAY_KEY_ID: optionalString(z.string().min(1)),
  RAZORPAY_KEY_SECRET: optionalString(z.string().min(1)),
  RAZORPAY_WEBHOOK_SECRET: optionalString(z.string().min(1)),

  // Meta WhatsApp Cloud API
  WHATSAPP_PHONE_NUMBER_ID: optionalString(z.string().min(1)),
  WHATSAPP_ACCESS_TOKEN: optionalString(z.string().min(1)),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalString(z.string().min(1)),
  WHATSAPP_APP_SECRET: optionalString(z.string().min(1)),

  // Object storage (S3-compatible)
  STORAGE_ENDPOINT: optionalString(z.string().url()),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: optionalString(z.string().min(1)),
  STORAGE_ACCESS_KEY_ID: optionalString(z.string().min(1)),
  STORAGE_SECRET_ACCESS_KEY: optionalString(z.string().min(1)),

  WEB_APP_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_APP_URL: z.string().url().default('http://localhost:3001'),
  OWNER_APP_URL: z.string().url().default('http://localhost:3002'),

  // How many reverse-proxy hops sit in front of the API, so req.ip (used
  // by rate limiting and audit logs) is the real client and not a proxy.
  // Deliberately NOT defaulted to a fixed count: it depends on the actual
  // hosting topology and must be verified per provider. Unset/"false" =
  // trust no proxy header. Accepts a hop count ("1"), or an Express
  // trust-proxy value such as "loopback" or a CIDR list.
  TRUST_PROXY: optionalString(z.string().min(1)),
});

// In production, fail fast on the misconfigurations that would silently
// break credentialed cross-subdomain auth or ship dev secrets: CORS
// origins must be exact https origins (a trailing slash or path never
// matches the browser's Origin header), and secrets must not be the
// dev placeholders.
const productionChecks = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  for (const key of ['WEB_APP_URL', 'ADMIN_APP_URL', 'OWNER_APP_URL'] as const) {
    const value = env[key];
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'must be an exact https origin with no path or trailing slash in production',
      });
    }
  }

  const secrets = ['CUSTOMER_SESSION_SECRET', 'AUTH_JWT_SECRET'] as const;
  for (const key of secrets) {
    if (env[key].startsWith('dev_only')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'must not be a dev placeholder secret in production',
      });
    }
  }
});

export type Env = z.infer<typeof productionChecks>;

let cachedEnv: Env | undefined;

/**
 * Validates process.env once and caches the result. Call at process boot
 * (main.ts) so a misconfigured deployment fails immediately instead of
 * mid-request.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = productionChecks.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}
