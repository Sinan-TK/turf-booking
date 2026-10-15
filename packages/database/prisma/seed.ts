import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Kerala launch reference data — district codes are internal platform
// codes, not official government codes (see schema.prisma §6.6 / the
// Facility Code spec). Every district gets a FacilityCodeSequence row so
// facility-code generation (Phase 4) never has to special-case "first
// facility in this district."
const KERALA_DISTRICTS: Array<{ name: string; code: string }> = [
  { name: 'Alappuzha', code: 'ALP' },
  { name: 'Ernakulam', code: 'EKM' },
  { name: 'Idukki', code: 'IDK' },
  { name: 'Kannur', code: 'KNR' },
  { name: 'Kasaragod', code: 'KSG' },
  { name: 'Kollam', code: 'KLM' },
  { name: 'Kottayam', code: 'KTM' },
  { name: 'Kozhikode', code: 'KKD' },
  { name: 'Malappuram', code: 'MPM' },
  { name: 'Palakkad', code: 'PKD' },
  { name: 'Pathanamthitta', code: 'PTA' },
  { name: 'Thiruvananthapuram', code: 'TVM' },
  { name: 'Thrissur', code: 'TSR' },
  { name: 'Wayanad', code: 'WYD' },
];

/**
 * Bootstrap reference data every environment needs before the platform
 * is usable: India/Kerala + its districts (with Facility Code sequences
 * seeded), a platform-default cancellation policy, and a
 * platform-default commission.
 *
 * Deliberately does NOT create the dev Super Admin/Owner logins —
 * `prisma db seed` isn't a safe place to create credentials. Run
 * `pnpm --filter @venue/database seed:identity` separately for that.
 */
async function main() {
  const india = await prisma.country.upsert({
    where: { isoCode: 'IN' },
    update: {},
    create: { name: 'India', isoCode: 'IN' },
  });

  const kerala = await prisma.state.upsert({
    where: { countryId_code: { countryId: india.id, code: 'KL' } },
    update: {},
    create: { countryId: india.id, name: 'Kerala', code: 'KL' },
  });

  for (const d of KERALA_DISTRICTS) {
    const district = await prisma.district.upsert({
      where: { stateId_code: { stateId: kerala.id, code: d.code } },
      update: {},
      create: {
        stateId: kerala.id,
        name: d.name,
        code: d.code,
        timezone: 'Asia/Kolkata',
      },
    });
    await prisma.facilityCodeSequence.upsert({
      where: { districtId: district.id },
      update: {},
      create: { districtId: district.id }, // nextNumber defaults to 10000
    });
  }
  console.log(`Seeded ${KERALA_DISTRICTS.length} Kerala districts under ${kerala.code}.`);

  const cancellationPolicy = await prisma.cancellationPolicy.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      scope: 'PLATFORM_DEFAULT',
      tiers: [
        { minHoursBeforeStart: 24, refundPercent: 100 },
        { minHoursBeforeStart: 12, refundPercent: 50 },
        { minHoursBeforeStart: 0, refundPercent: 0 },
      ],
    },
  });

  const commission = await prisma.commission.upsert({
    where: { id: '00000000-0000-0000-0000-000000000002' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      scope: 'PLATFORM_DEFAULT',
      type: 'PERCENTAGE',
      value: 10, // 10% platform commission, adjustable by Super Admin
    },
  });

  if (process.env.NODE_ENV !== 'production') {
    // The dev owner organization's row is still useful reference data on
    // its own (independent of who the owner login is) — kept here.
    // Its VenueOwnerUser is created by seed-identity.ts, not this script.
    await prisma.ownerOrganization.upsert({
      where: { id: '00000000-0000-0000-0000-000000000003' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-000000000003',
        name: 'Dev Test Venues Pvt Ltd',
        contactEmail: 'owner@turf.local',
        contactPhone: '+910000000000',
      },
    });
  }

  console.log('Seeded:', { cancellationPolicy: cancellationPolicy.id, commission: commission.id });

  await seedP1VenueSkeleton();
}

// =====================================================================
// P1: Universal hourly-venue domain skeleton (additive seed only)
// ---------------------------------------------------------------------
// - 11 VenueCategory rows (DB-driven taxonomy; future categories are
//   INSERTs, never schema changes).
// - One deterministic PLATFORM_DEFAULT BookingPolicy mirroring today's
//   hardcoded rules (60-min grid, 60-180 min, no buffers, 30d/0m).
// - Verbatim backfill copies of OperatingHours -> AvailabilityRule and
//   BlockedDate -> BlockedPeriod for P3 cutover verification. Legacy
//   tables stay authoritative in P1.
// - Everything is upsert-keyed (slug / fixed id / source id): running
//   the seed twice creates zero duplicates.
// - Prerequisite gate (P1 req 3/4): the canonical base-seed
//   CancellationPolicy 00000000-0000-0000-0000-000000000001 must exist.
//   If it is missing, STOP — do not invent or insert a replacement.
// =====================================================================

const P1_VENUE_CATEGORIES: Array<{
  slug: string;
  name: string;
  mode: 'EXCLUSIVE' | 'POOLED';
  iconKey: string;
  unitLabel: string;
  venueLabel: string;
  unitTypes: string[];
  sortOrder: number;
}> = [
  { slug: 'FOOTBALL_TURF', name: 'Football Turf', mode: 'EXCLUSIVE', iconKey: 'sports_soccer', unitLabel: 'Pitch', venueLabel: 'Turf', unitTypes: ['5S', '7S'], sortOrder: 0 },
  { slug: 'BADMINTON', name: 'Badminton Court', mode: 'EXCLUSIVE', iconKey: 'sports_tennis', unitLabel: 'Court', venueLabel: 'Badminton venue', unitTypes: [], sortOrder: 10 },
  { slug: 'TENNIS', name: 'Tennis Court', mode: 'EXCLUSIVE', iconKey: 'sports_tennis', unitLabel: 'Court', venueLabel: 'Tennis venue', unitTypes: [], sortOrder: 20 },
  { slug: 'SWIMMING_POOL', name: 'Swimming Pool (entire)', mode: 'EXCLUSIVE', iconKey: 'pool', unitLabel: 'Pool', venueLabel: 'Pool', unitTypes: [], sortOrder: 30 },
  { slug: 'BILLIARDS', name: 'Billiards Table', mode: 'EXCLUSIVE', iconKey: 'sports_bar', unitLabel: 'Table', venueLabel: 'Billiards club', unitTypes: [], sortOrder: 40 },
  { slug: 'SNOOKER', name: 'Snooker Table', mode: 'EXCLUSIVE', iconKey: 'sports_bar', unitLabel: 'Table', venueLabel: 'Snooker club', unitTypes: [], sortOrder: 50 },
  { slug: 'GAMING_STATION', name: 'Gaming Station', mode: 'EXCLUSIVE', iconKey: 'sports_esports', unitLabel: 'Station', venueLabel: 'Gaming lounge', unitTypes: [], sortOrder: 60 },
  { slug: 'PHOTO_STUDIO', name: 'Photography Studio', mode: 'EXCLUSIVE', iconKey: 'photo_camera', unitLabel: 'Studio', venueLabel: 'Photo studio', unitTypes: [], sortOrder: 70 },
  { slug: 'STUDIO', name: 'Studio (other)', mode: 'EXCLUSIVE', iconKey: 'mic', unitLabel: 'Studio', venueLabel: 'Studio', unitTypes: [], sortOrder: 80 },
  { slug: 'KAYAKING', name: 'Kayaking', mode: 'POOLED', iconKey: 'kayaking', unitLabel: 'Kayak', venueLabel: 'Kayaking spot', unitTypes: [], sortOrder: 90 },
  { slug: 'GENERIC', name: 'Generic Hourly Venue', mode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [], sortOrder: 1000 },
];

const P1_BASE_CANCELLATION_POLICY_ID = '00000000-0000-0000-0000-000000000001';
const P1_PLATFORM_POLICY_ID = '00000000-0000-0000-0000-000000000101';

async function seedP1VenueSkeleton() {
  for (const c of P1_VENUE_CATEGORIES) {
    await prisma.venueCategory.upsert({
      where: { slug: c.slug },
      // Re-seeding only refreshes display metadata. name / mode / isActive
      // are admin-managed now (Super Admin portal) and must not be reset.
      update: {
        iconKey: c.iconKey,
        unitLabel: c.unitLabel,
        venueLabel: c.venueLabel,
        unitTypes: c.unitTypes,
        sortOrder: c.sortOrder,
      },
      create: {
        slug: c.slug,
        name: c.name,
        defaultAllocationMode: c.mode,
        isActive: true,
        iconKey: c.iconKey,
        unitLabel: c.unitLabel,
        venueLabel: c.venueLabel,
        unitTypes: c.unitTypes,
        sortOrder: c.sortOrder,
      },
    });
  }
  console.log(`Seeded ${P1_VENUE_CATEGORIES.length} venue categories.`);

  const basePolicy = await prisma.cancellationPolicy.findUnique({
    where: { id: P1_BASE_CANCELLATION_POLICY_ID },
  });
  if (!basePolicy) {
    throw new Error(
      `P1 seed blocked: CancellationPolicy ${P1_BASE_CANCELLATION_POLICY_ID} is missing. ` +
        `Run the base reference seed first; refusing to invent or insert a replacement record (P1 req 4).`,
    );
  }

  const platformPolicyData = {
    scope: 'PLATFORM_DEFAULT' as const,
    slotIntervalMin: 60,
    minDurationMin: 60,
    maxDurationMin: 180,
    durationIncrementMin: 60,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    maxAdvanceDays: 30,
    minLeadMinutes: 0,
    cancellationPolicyId: P1_BASE_CANCELLATION_POLICY_ID,
  };
  await prisma.bookingPolicy.upsert({
    where: { id: P1_PLATFORM_POLICY_ID },
    update: platformPolicyData,
    create: { id: P1_PLATFORM_POLICY_ID, ...platformPolicyData },
  });
  console.log(`Seeded platform-default booking policy ${P1_PLATFORM_POLICY_ID}.`);

  // Verbatim copies — Timestamptz/string values copied with NO conversion.
  // Legacy tables remain authoritative in P1; these rows exist so P3 can
  // diff old vs new before cutover.
  const hours = await prisma.operatingHours.findMany();
  for (const h of hours) {
    await prisma.availabilityRule.upsert({
      where: { sourceOperatingHoursId: h.id },
      update: {
        venueId: h.venueId,
        weekday: h.weekday,
        openTime: h.openTime,
        closeTime: h.closeTime,
      },
      create: {
        venueId: h.venueId,
        weekday: h.weekday,
        openTime: h.openTime,
        closeTime: h.closeTime,
        sourceOperatingHoursId: h.id,
      },
    });
  }
  console.log(`Backfilled ${hours.length} availability rules from operating hours.`);

  const blocks = await prisma.blockedDate.findMany();
  for (const b of blocks) {
    await prisma.blockedPeriod.upsert({
      where: { sourceBlockedDateId: b.id },
      update: {
        venueId: b.venueId,
        resourceId: b.resourceId,
        startTime: b.startTime,
        endTime: b.endTime,
        reason: b.reason,
        createdByOwnerUserId: b.createdByOwnerUserId,
      },
      create: {
        venueId: b.venueId,
        resourceId: b.resourceId,
        startTime: b.startTime,
        endTime: b.endTime,
        reason: b.reason,
        createdByOwnerUserId: b.createdByOwnerUserId,
        sourceBlockedDateId: b.id,
      },
    });
  }
  console.log(`Backfilled ${blocks.length} blocked periods from blocked dates.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
