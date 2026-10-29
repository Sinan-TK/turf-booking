import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs once after the whole API suite: removes the data the tests created (E2E_ facilities, "E2E …" venues, e2e-… logins and so
 * on, with everything that hangs off them), so the suite leaves its database as it found it. Set E2E_KEEP_DATA=1 to keep it
 * (for example to look at a failure in the database). It uses the same database the tests used: apps/api/.env.test when it
 * exists, else apps/api/.env.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA) return;
  loadDotenv({ path: resolve(__dirname, '../../.env'), override: true });
  const testEnv = resolve(__dirname, '../../.env.test');
  if (existsSync(testEnv)) loadDotenv({ path: testEnv, override: true });

  const { prisma, purgeTestData } = await import('@venue/database');
  try {
    const result = await purgeTestData(prisma);
    console.log(`\nTest data cleaned up: ${result.total} rows from ${Object.keys(result.tables).length} tables.`);
  } catch (error) {
    // A failed cleanup must not fail a passing run; it can be repeated with: pnpm --filter @venue/database purge:test-data
    console.warn('\nCould not clean up the test data:', error instanceof Error ? error.message : error);
  } finally {
    await prisma.$disconnect();
  }
}
