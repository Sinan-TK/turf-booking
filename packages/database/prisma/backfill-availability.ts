/**
 * Idempotent sync of the legacy availability tables into their P3 twins:
 *   operating_hours -> availability_rules  (keyed by sourceOperatingHoursId)
 *   blocked_dates   -> blocked_periods     (keyed by sourceBlockedDateId)
 *
 * Run it BEFORE deploying a build that reads AVAILABILITY_SOURCE=rules
 * (the default) against a database whose hours/blocks predate the
 * dual-write in VenueConfigService. Re-running is safe: every row is an
 * upsert on its source id, so nothing is duplicated, and it never deletes
 * or modifies a legacy row. It also reports any twin rows whose source has
 * been removed (orphans) without touching them.
 *
 * Rollback needs no data work: set AVAILABILITY_SOURCE=legacy.
 *
 * Usage:
 *   pnpm --filter @venue/database exec tsx prisma/backfill-availability.ts
 *   railway run pnpm --filter @venue/database exec tsx prisma/backfill-availability.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
  console.log(`Backfilling availability twins on ${host}`);

  const hours = await prisma.operatingHours.findMany();
  for (const h of hours) {
    await prisma.availabilityRule.upsert({
      where: { sourceOperatingHoursId: h.id },
      update: { venueId: h.venueId, weekday: h.weekday, openTime: h.openTime, closeTime: h.closeTime },
      create: {
        venueId: h.venueId,
        weekday: h.weekday,
        openTime: h.openTime,
        closeTime: h.closeTime,
        sourceOperatingHoursId: h.id,
      },
    });
  }
  console.log(`Synced ${hours.length} availability rules from operating hours.`);

  const blocks = await prisma.blockedDate.findMany();
  for (const b of blocks) {
    const data = {
      venueId: b.venueId,
      resourceId: b.resourceId,
      startTime: b.startTime,
      endTime: b.endTime,
      reason: b.reason,
      createdByOwnerUserId: b.createdByOwnerUserId,
    };
    await prisma.blockedPeriod.upsert({
      where: { sourceBlockedDateId: b.id },
      update: data,
      create: { ...data, sourceBlockedDateId: b.id },
    });
  }
  console.log(`Synced ${blocks.length} blocked periods from blocked dates.`);

  const [orphanRules, orphanBlocks] = await Promise.all([
    prisma.availabilityRule.count({
      where: { sourceOperatingHoursId: { not: null }, NOT: { sourceOperatingHoursId: { in: hours.map((h) => h.id) } } },
    }),
    prisma.blockedPeriod.count({
      where: { sourceBlockedDateId: { not: null }, NOT: { sourceBlockedDateId: { in: blocks.map((b) => b.id) } } },
    }),
  ]);
  if (orphanRules || orphanBlocks) {
    console.warn(
      `WARNING: ${orphanRules} availability rule(s) and ${orphanBlocks} blocked period(s) have no legacy source row (left untouched).`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
