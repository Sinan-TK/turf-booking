import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

// Same fix as main.ts and the same reason (documented there in detail):
// @venue/database's own dotenv side-effect loads a *different* .env file
// first via require() hoisting, and without `override: true` that file's
// stale values win. Jest's setupFilesAfterEnv runs as a fully separate
// phase before any spec file is `require()`d, so this reliably wins the
// race even more robustly than main.ts's "first line of the file" trick.
loadDotenv({ path: resolve(__dirname, '../../.env'), override: true });

// Semantically correct even though "development" would behave the same
// for the secure-cookie check in auth.constants.ts (anything !==
// "production") — this is what the test suite actually is.
process.env.NODE_ENV = 'test';
