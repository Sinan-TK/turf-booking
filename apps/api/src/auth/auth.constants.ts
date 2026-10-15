import { loadEnv } from '@venue/config';

export const CUSTOMER_SESSION_COOKIE = 'customer_session';

/**
 * Admin/owner sessions are httpOnly cookies set by this API. Names are
 * per-portal because cookies are scoped by host, not port — on localhost
 * the admin (3001) and owner (3002) apps would otherwise overwrite each
 * other's session. The refresh cookie is path-scoped to /auth so it is
 * only ever sent to the auth endpoints.
 */
export const STAFF_COOKIES = {
  ADMIN: { access: 'admin_access', refresh: 'admin_refresh' },
  OWNER: { access: 'owner_access', refresh: 'owner_refresh' },
} as const;

export const STAFF_REFRESH_COOKIE_PATH = '/auth';

export function staffCookieOptions(maxAgeMs: number, path = '/') {
  return {
    httpOnly: true,
    secure: loadEnv().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path,
    maxAge: maxAgeMs,
  };
}

/**
 * A function, not a pre-computed constant — deliberately. `loadEnv()`
 * caches its result on first call (packages/config/src/env.ts), and this
 * module is reached through AppModule's import graph *before* main.ts's
 * own `override: true` dotenv load runs (the exact require()-hoisting
 * order main.ts's own comment documents). A module-scope
 * `const isProduction = loadEnv().NODE_ENV === ...` here would call
 * loadEnv() during that early, pre-override window and cache the wrong
 * (packages/database/.env-sourced) values for the whole process —
 * caught live: a `pnpm dev` boot crashed with "`key_id` or `oauthToken`
 * is mandatory" from RazorpayProvider, because the cached env had
 * RAZORPAY_KEY_ID="" baked in before main.ts ever got to fix it.
 * Computing `secure` inside a function instead defers the loadEnv()
 * call to actual request time, long after bootstrap (and the override
 * fix) has completed.
 */
function customerSessionCookieOptions() {
  return {
    httpOnly: true,
    // `Secure` outside production only: real browsers (Chromium,
    // Firefox) special-case http://localhost as a secure context, but
    // generic HTTP clients — supertest's cookie jar included — don't,
    // which the e2e suite's cross-request auth flow depends on.
    secure: loadEnv().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export const CUSTOMER_SESSION_COOKIE_OPTIONS = customerSessionCookieOptions;
