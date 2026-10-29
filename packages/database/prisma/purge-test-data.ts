/**
 * Removes the data the automated tests left in the database (see src/purge-test-data.ts for exactly what counts as test data).
 *   pnpm --filter @venue/database purge:test-data -- --dry-run     (shows what would go, changes nothing)
 *   pnpm --filter @venue/database purge:test-data
 */
import { prisma, purgeTestData } from '../src';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await purgeTestData(prisma, { dryRun });
  const lines = Object.entries(result.tables).sort((a, b) => b[1] - a[1]).map(([t, n]) => `  ${t.padEnd(28)} ${n}`);
  console.log(`${dryRun ? 'Would remove' : 'Removed'} ${result.total} rows from ${lines.length} tables:\n${lines.join('\n')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
