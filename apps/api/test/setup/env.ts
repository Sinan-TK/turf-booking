import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Same fix as main.ts and the same reason (documented there in detail):
// @venue/database's own dotenv side-effect loads a *different* .env file
// first via require() hoisting, and without `override: true` that file's
// stale values win. Jest's setupFilesAfterEnv runs as a fully separate
// phase before any spec file is `require()`d, so this reliably wins the
// race even more robustly than main.ts's "first line of the file" trick.
loadDotenv({ path: resolve(__dirname, '../../.env'), override: true });

// apps/api/.env points at the shared dev database (Neon). When an
// apps/api/.env.test exists (gitignored; e.g. DATABASE_URL at the local
// docker-compose Postgres), its values win so the suite never writes
// test rows into that shared database.
const testEnv = resolve(__dirname, '../../.env.test');
if (existsSync(testEnv)) loadDotenv({ path: testEnv, override: true });

// Semantically correct even though "development" would behave the same
// for the secure-cookie check in auth.constants.ts (anything !==
// "production") — this is what the test suite actually is.
process.env.NODE_ENV = 'test';

// Customer and owner Google sign-in run against the fake verifier (accepts test:<email>|<name>|<sub> tokens);
// the real one is covered by google-verifier.e2e-spec.ts with a stubbed Google client.
process.env.GOOGLE_AUTH_MODE = 'fake';
