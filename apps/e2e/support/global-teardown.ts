import { closeDatabase, database } from './customer';

/**
 * Runs once after every Playwright run: removes the data the tests created ("PW …" venues, customers and organisations, PW_
 * facilities, pw-… logins and everything that hangs off them), so a run leaves the database as it found it. Set E2E_KEEP_DATA=1
 * to keep it (for example to look at a failure). A run that was killed leaves its data behind; clean it with
 * `pnpm --filter @venue/database purge:test-data`.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA) return;
  try {
    const prisma = await database();
    const { purgeTestData } = await import('../../../packages/database/dist');
    const result = await purgeTestData(prisma);
    console.log(`\nTest data cleaned up: ${result.total} rows from ${Object.keys(result.tables).length} tables.`);
  } catch (error) {
    // A failed cleanup must not fail a passing run.
    console.warn('\nCould not clean up the test data:', error instanceof Error ? error.message : error);
  } finally {
    await closeDatabase();
  }
}
