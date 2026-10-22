/**
 * One-off: opening hours are retired. A unit can now be booked only where one of its
 * active prices covers the day and time, so each venue's saved opening hours are folded
 * into its prices. Run it once, BEFORE deploying a build that no longer reads opening
 * hours, otherwise a venue whose prices are "all day" becomes bookable around the clock.
 *
 * For every active price rule of a venue that has hours, the rule is intersected with the
 * hours of each weekday it covers:
 *   - if that changes nothing (the prices already sit inside the hours) the rule is left alone;
 *   - otherwise the rule is BLOCKED (isActive=false, kept for reference, never deleted) and
 *     replaced by timed copies: one per distinct set of weekdays that share the same hours.
 * A venue with no hours at all is untouched (it was "open all day" before and still is).
 * Blocked originals can be removed from the owner screen once the owner has checked the result.
 *
 * It is a DRY RUN unless you pass --apply. Re-running is safe: converted copies sit inside the
 * hours, so a second pass finds nothing to change.
 *
 * Usage:
 *   pnpm --filter @venue/database exec tsx prisma/convert-hours-to-prices.ts           # dry run
 *   pnpm --filter @venue/database exec tsx prisma/convert-hours-to-prices.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DAY = 24 * 60;

type Win = [number, number];

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Closing at 23:59 was how "until the end of the day" was written. */
const closeMin = (hhmm: string): number => (toMin(hhmm) >= DAY - 1 ? DAY : toMin(hhmm));
const LEGACY_DAYS: Record<string, number[]> = { WEEKDAY: [1, 2, 3, 4, 5], WEEKEND: [6, 7], HOLIDAY: [] };

function intersect(w: Win, hours: Win[]): Win[] {
  const out: Win[] = [];
  for (const h of hours) {
    const lo = Math.max(w[0], h[0]);
    const hi = Math.min(w[1], h[1]);
    if (lo < hi) out.push([lo, hi]);
  }
  return out;
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? 'postgresql://unset').hostname;
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'}: folding opening hours into prices on ${host}`);

  // Venue hours: venue-wide AvailabilityRule rows (weekday 0 = Sunday), else the legacy table.
  const hours = new Map<string, Map<number, Win[]>>();
  const add = (venueId: string, weekday: number, open: string, close: string) => {
    const iso = weekday === 0 ? 7 : weekday;
    const days = hours.get(venueId) ?? new Map<number, Win[]>();
    days.set(iso, [...(days.get(iso) ?? []), [toMin(open), closeMin(close)]]);
    hours.set(venueId, days);
  };
  const rules = await prisma.availabilityRule.findMany({ where: { resourceId: null, resourceGroupId: null } });
  for (const r of rules) add(r.venueId, r.weekday, r.openTime, r.closeTime);
  const legacy = await prisma.operatingHours.findMany();
  for (const h of legacy) if (!hours.has(h.venueId)) add(h.venueId, h.weekday, h.openTime, h.closeTime);
  console.log(`${hours.size} venues have opening hours`);

  const prices = await prisma.pricingRule.findMany({
    where: { isActive: true },
    include: { resource: { select: { venueId: true } }, resourceGroup: { select: { venueId: true } } },
  });

  let unchanged = 0;
  let blocked = 0;
  let created = 0;
  const touchedVenues = new Set<string>();

  for (const rule of prices) {
    const venueId = rule.resource?.venueId ?? rule.resourceGroup?.venueId;
    const venueHours = venueId ? hours.get(venueId) : undefined;
    if (!venueId || !venueHours) {
      unchanged++;
      continue;
    }
    const days = rule.weekdays.length ? rule.weekdays : LEGACY_DAYS[rule.dayType ?? ''] ?? [];
    const own: Win =
      rule.startWindow && rule.endWindow ? [toMin(rule.startWindow), closeMin(rule.endWindow)] : [0, DAY];

    const groups = new Map<string, { days: number[]; wins: Win[] }>();
    let same = true;
    for (const d of days) {
      const wins = intersect(own, venueHours.get(d) ?? []);
      if (!(wins.length === 1 && wins[0]![0] === own[0] && wins[0]![1] === own[1])) same = false;
      const key = JSON.stringify(wins);
      const g = groups.get(key) ?? { days: [], wins };
      g.days.push(d);
      groups.set(key, g);
    }
    if (same) {
      unchanged++;
      continue;
    }

    touchedVenues.add(venueId);
    blocked++;
    const copies = [...groups.values()].filter((g) => g.wins.length > 0);
    for (const g of copies) created += g.wins.length;
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      await tx.pricingRule.update({ where: { id: rule.id }, data: { isActive: false } });
      for (const g of copies) {
        for (const w of g.wins) {
          const allDay = w[0] === 0 && w[1] === DAY;
          await tx.pricingRule.create({
            data: {
              resourceId: rule.resourceId,
              resourceGroupId: rule.resourceGroupId,
              durationMinutes: rule.durationMinutes,
              weekdays: g.days.sort((a, b) => a - b),
              startWindow: allDay ? null : toHHmm(w[0]),
              endWindow: allDay ? null : w[1] === DAY ? '24:00' : toHHmm(w[1]),
              pricingMode: rule.pricingMode,
              normalPrice: rule.normalPrice,
              offerPrice: rule.offerPrice,
              bookingPrice: rule.bookingPrice,
              currency: rule.currency,
              effectiveFrom: rule.effectiveFrom,
            },
          });
        }
      }
    });
  }

  console.log(
    `${prices.length} active prices: ${unchanged} already inside the hours (left alone), ` +
      `${blocked} to block and replace with ${created} timed copies, across ${touchedVenues.size} venues` +
      (APPLY ? '' : '  (dry run: nothing was changed; re-run with --apply)'),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
