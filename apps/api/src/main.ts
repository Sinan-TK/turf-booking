import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { loadEnv } from '@venue/config';
import { AppModule } from './app.module';

// `override: true` is load-bearing, not a style choice: TypeScript
// compiles `import { AppModule } from './app.module'` to a `require()`
// hoisted above this line regardless of source order, and that require
// chain reaches @venue/database -> @prisma/client, which has its own
// dotenv side-effect that loads packages/database/.env — a *different*
// file, still carrying an empty `RAZORPAY_KEY_ID=` placeholder from an
// earlier phase before Phase 6 needed a real value here. Without
// `override`, dotenv's default "don't clobber an existing key" behavior
// means that empty value wins and apps/api/.env's real one is silently
// ignored — confirmed by instrumenting this call during Phase 6's live
// testing (`parsed keys: 28` but the actual process.env value stayed
// empty). This makes apps/api's own .env authoritative for apps/api,
// which is the correct behavior regardless of what any dependency loads.
loadDotenv({ path: resolve(process.cwd(), '.env'), override: true });

// express's res.json() -> JSON.stringify() throws on BigInt (Prisma
// returns Booking.orderSeq as a BigInt). Without this, the response
// serialization fails *after* the DB transaction already committed —
// the client sees a 500 for a booking that actually succeeded, which is
// worse than a normal error (they can't tell whether to retry).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (!raw || raw === 'false') return false;
  // "true" would trust every hop in X-Forwarded-For (fully spoofable);
  // require an explicit hop count or address list instead.
  if (raw === 'true') {
    throw new Error('TRUST_PROXY=true is unsafe; set a hop count (e.g. 1) or a subnet/keyword');
  }
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}

async function bootstrap() {
  // Fail fast on a misconfigured deployment instead of surfacing missing
  // env vars deep inside a request handler (ARCHITECTURE.md §2).
  const env = loadEnv();

  // rawBody: true populates request.rawBody (a Buffer) alongside the
  // normal parsed body, for the Razorpay webhook route — signature
  // verification must hash the exact bytes sent, not a re-serialized
  // JSON.stringify(JSON.parse(body)), which can differ (key order,
  // whitespace) and would make every signature check fail.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // req.ip drives the throttler and audit-log IPs. Behind a reverse proxy
  // it is the proxy's address unless Express is told how many hops to
  // trust — and trusting too many lets a client spoof X-Forwarded-For to
  // dodge rate limits. So this is explicit configuration (TRUST_PROXY),
  // not a guess: verify the real hop count for your host first.
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy !== false) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [env.WEB_APP_URL, env.ADMIN_APP_URL, env.OWNER_APP_URL],
    credentials: true,
  });

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on port ${env.PORT}`);
}

bootstrap();
// touch: trigger a GitHub-sourced Railway build after fixing next@14.2.15 in the lockfile
// touch: force Railway rebuild for Supabase Auth + Node 22 migration
