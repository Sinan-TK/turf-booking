/**
 * Seeds 10 bookable venues in Malappuram, Kerala (India -> Kerala/KL ->
 * Malappuram/MPM), each with: ACTIVE status, weekly operating hours,
 * facility tags, a 7s Full + 2x 5s halves resource graph (composition +
 * closure rows, mirroring ResourcesService), and weekday/weekend pricing.
 *
 * Idempotent: re-running skips venues whose name already exists in the
 * district. Facility codes use the same atomic UPDATE...RETURNING
 * sequence as FacilityCodeService (KLMPM10001, ...).
 *
 * Run:  npx tsx prisma/seed-malappuram-venues.ts   (from packages/database)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VENUES = [
  { town: 'Kottakkal', name: 'Kottakkal Arena 2', address: 'Changuvetty, Kottakkal, Malappuram, Kerala 676501', lat: 11.001, lng: 76.001 },
  { town: 'Manjeri', name: 'Manjeri Sports Park Turf', address: 'Nellikkuth, Manjeri, Malappuram, Kerala 676122', lat: 11.121, lng: 76.121 },
  { town: 'Perinthalmanna', name: 'Perinthalmanna Greenfield Turf', address: 'Jubilee Road, Perinthalmanna, Malappuram, Kerala 679322', lat: 10.978, lng: 76.226 },
  { town: 'Tirur', name: 'Tirur Riverside 3', address: 'Tirur Town, Malappuram, Kerala 676101', lat: 10.917, lng: 75.926 },
  { town: 'Ponnani', name: 'Ponnani Coastal Sports Turf', address: 'Ponnani South, Malappuram, Kerala 679586', lat: 10.767, lng: 75.926 },
  { town: 'Kondotty', name: 'Kondotty Skyline Turf', address: 'Kondotty Town, Malappuram, Kerala 673638', lat: 11.146, lng: 75.961 },
  { town: 'Tanur', name: 'Tanur Beachside 4', address: 'Tanur Town, Malappuram, Kerala 676302', lat: 10.975, lng: 75.87 },
  { town: 'Nilambur', name: 'Nilambur Teak Valley Turf', address: 'Nilambur Town, Malappuram, Kerala 679329', lat: 11.277, lng: 76.224 },
  { town: 'Valanchery', name: 'Valanchery Central Sports Turf', address: 'Valanchery, Malappuram, Kerala 676552', lat: 10.895, lng: 76.072 },
  { town: 'Edappal', name: 'Edappal Palm Grove Turf', address: 'Edappal, Malappuram, Kerala 679576', lat: 10.786, lng: 76.01 },
];

async function nextFacilityCode(districtId: string, stateCode: string, districtCode: string) {
  const rows = await prisma.$queryRaw<Array<{ nextNumber: number }>>`
    UPDATE facility_code_sequences
    SET "nextNumber" = "nextNumber" + 1, "updatedAt" = now()
    WHERE "districtId" = ${districtId}::uuid
    RETURNING "nextNumber"
  `;
  const nextNumber = rows[0]?.nextNumber;
  if (nextNumber === undefined) throw new Error('District has no facility code sequence');
  return `${stateCode}${districtCode}${String(nextNumber).padStart(5, '0')}`;
}

async function main() {
  const country = await prisma.country.upsert({
    where: { isoCode: 'IN' },
    update: {},
    create: { name: 'India', isoCode: 'IN' },
  });
  const state = await prisma.state.upsert({
    where: { countryId_code: { countryId: country.id, code: 'KL' } },
    update: {},
    create: { countryId: country.id, name: 'Kerala', code: 'KL' },
  });
  const district = await prisma.district.upsert({
    where: { stateId_code: { stateId: state.id, code: 'MPM' } },
    update: {},
    create: { stateId: state.id, name: 'Malappuram', code: 'MPM', timezone: 'Asia/Kolkata' },
  });
  await prisma.facilityCodeSequence.upsert({
    where: { districtId: district.id },
    update: {},
    create: { districtId: district.id, nextNumber: 10000 },
  });

  const areaByTown = new Map<string, string>();
  for (const t of VENUES) {
    const area = await prisma.area.upsert({
      where: { districtId_name: { districtId: district.id, name: t.town } },
      update: {},
      create: { districtId: district.id, name: t.town },
    });
    areaByTown.set(t.town, area.id);
  }

  const org = await prisma.ownerOrganization.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Malappuram Sports Collective',
      contactEmail: 'ops@mpm-sports.example.com',
      contactPhone: '+914833000001',
    },
  });

  const footballCategory = await prisma.venueCategory.findUnique({ where: { slug: 'FOOTBALL_TURF' } });
  if (!footballCategory) throw new Error('FOOTBALL_TURF venue category missing — run the migrations / base seed first.');

  let created = 0;
  for (const [i, t] of VENUES.entries()) {
    const existing = await prisma.venue.findFirst({ where: { districtId: district.id, name: t.name } });
    if (existing) {
      console.log(`SKIP ${t.name} (${existing.facilityCode})`);
      continue;
    }
    const facilityCode = await nextFacilityCode(district.id, state.code, district.code);
    const venue = await prisma.venue.create({
      data: {
        organizationId: org.id,
        categoryId: footballCategory.id,
        facilityCode,
        name: t.name,
        description: `Floodlit football turf in ${t.town}, Malappuram. Online slot booking available.`,
        districtId: district.id,
        areaId: areaByTown.get(t.town),
        address: t.address,
        lat: t.lat,
        lng: t.lng,
        timezone: 'Asia/Kolkata',
        status: 'ACTIVE',
        defaultSlotGranularityMinutes: 60,
      },
    });

    await prisma.operatingHours.createMany({
      data: Array.from({ length: 7 }, (_, weekday) => ({
        venueId: venue.id,
        weekday,
        openTime: '06:00',
        closeTime: '22:00',
      })),
    });
    await prisma.venueFacilityTag.createMany({
      data: ['PARKING', 'WASHROOM', 'FLOODLIGHTS', 'DRINKING_WATER'].map((tag) => ({
        venueId: venue.id,
        tag,
      })),
    });

    // Resource graph: 7s Full composed of 5s A + 5s B (self closure rows
    // included, mirroring ResourcesService.create/addComposition).
    const full = await prisma.resource.create({
      data: { venueId: venue.id, name: '7s Full Ground', groundType: '7S', isBookable: true, sortOrder: 0 },
    });
    const halfA = await prisma.resource.create({
      data: { venueId: venue.id, name: '5s Ground A', groundType: '5S', isBookable: true, sortOrder: 1 },
    });
    const halfB = await prisma.resource.create({
      data: { venueId: venue.id, name: '5s Ground B', groundType: '5S', isBookable: true, sortOrder: 2 },
    });
    await prisma.resourceClosure.createMany({
      data: [
        { ancestorId: full.id, descendantId: full.id, depth: 0 },
        { ancestorId: halfA.id, descendantId: halfA.id, depth: 0 },
        { ancestorId: halfB.id, descendantId: halfB.id, depth: 0 },
      ],
    });
    await prisma.resourceComposition.createMany({
      data: [
        { parentResourceId: full.id, childResourceId: halfA.id },
        { parentResourceId: full.id, childResourceId: halfB.id },
      ],
    });
    await prisma.resourceClosure.createMany({
      data: [
        { ancestorId: full.id, descendantId: halfA.id, depth: 1 },
        { ancestorId: full.id, descendantId: halfB.id, depth: 1 },
      ],
    });

    // Pricing: 60-min slots, weekday/weekend, INR.
    const base7 = 1100 + i * 50;
    const base5 = 650 + i * 25;
    await prisma.pricingRule.createMany({
      data: [
        { resourceId: full.id, durationMinutes: 60, dayType: 'WEEKDAY', price: base7, currency: 'INR' },
        { resourceId: full.id, durationMinutes: 60, dayType: 'WEEKEND', price: base7 + 300, currency: 'INR' },
        { resourceId: halfA.id, durationMinutes: 60, dayType: 'WEEKDAY', price: base5, currency: 'INR' },
        { resourceId: halfA.id, durationMinutes: 60, dayType: 'WEEKEND', price: base5 + 150, currency: 'INR' },
        { resourceId: halfB.id, durationMinutes: 60, dayType: 'WEEKDAY', price: base5, currency: 'INR' },
        { resourceId: halfB.id, durationMinutes: 60, dayType: 'WEEKEND', price: base5 + 150, currency: 'INR' },
      ],
    });

    created++;
    console.log(`CREATED ${facilityCode} ${t.name}`);
  }
  console.log(`Done. Created ${created}, skipped ${VENUES.length - created}.`);
}

main()
  .catch((e) => {
    console.error('SEED_FAILED:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
