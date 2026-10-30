import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { createTestApp } from './setup/test-app';
import {
  createCategoryFixture,
  createCustomerFixture,
  createOwnerFixture,
  createStaffFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';
import { SettlementsService } from '../src/settlements/settlements.service';

/** Hours of the previous month in IST: always in the past and always in one month, whenever the test runs. */
function lastMonthHour(i: number) {
  return DateTime.now().setZone('Asia/Kolkata').startOf('month').minus({ days: 10 }).plus({ hours: i }).toJSDate();
}

type Row = { id: string; name: string; bookings: number; collected: string; platform: string; refunded: string; earned: string };
const num = (v: string) => Number(v);

/** The owner's earnings by venue and by facility, and the bookings behind them. */
describe('Owner earnings breakdown', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let staff: TestAgent;
  let other: TestAgent; // another organisation's owner
  let settlements: SettlementsService;
  let slot = 0;
  let venue1: Awaited<ReturnType<typeof createVenueFixture>>;
  let venue2: Awaited<ReturnType<typeof createVenueFixture>>;
  let poolUnit: string;
  let poolCategory: string;
  let footballCategory: string;
  const order: Record<string, string> = {};

  /** A booking paid with coins, then moved to an ended slot last month. */
  async function playedBooking(resourceId: string, hourIndex: number) {
    const { agent, customerId } = await createCustomerFixture(app);
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(20 + Math.floor(slot / 12), 8 + (slot % 12)).toISOString(), durationMinutes: 60 });
    slot++;
    expect(hold.status).toBe(201);
    await admin.post('/admin/coins/adjust').send({ customerId, signedAmount: 5000, reason: 'E2E top-up' });
    expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    const start = lastMonthHour(hourIndex);
    await prisma.booking.update({ where: { id: hold.body.id }, data: { startTime: start, endTime: new Date(start.getTime() + 3_600_000) } });
    return hold.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const a = await createOwnerFixture(app, admin);
    owner = a.ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    venue1 = await createVenueFixture(app, owner, admin);
    venue2 = await createVenueFixture(app, owner, admin);
    ({ agent: staff } = await createStaffFixture(app, a.organizationId, [venue1.venueId]));
    settlements = app.get(SettlementsService);

    footballCategory = (await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'FOOTBALL_TURF' } })).id;
    poolCategory = await createCategoryFixture(admin);
    const unit = await owner
      .post('/resources')
      .send({ venueId: venue1.venueId, categoryId: poolCategory, name: 'Pool table', groundType: '', isBookable: true, sortOrder: 5 });
    expect(unit.status).toBe(201);
    poolUnit = unit.body.id;
    const rule = await owner
      .post('/resources/pricing-rules')
      .send({ resourceId: poolUnit, durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], normalPrice: 800, currency: 'INR' });
    expect(rule.status).toBe(201);

    // Venue 1: two football bookings and one pool booking. Venue 2: one football booking.
    order.v1f1 = await playedBooking(venue1.halfAId, 0);
    order.v1f2 = await playedBooking(venue1.halfAId, 1);
    order.v1p = await playedBooking(poolUnit, 2);
    order.v2f = await playedBooking(venue2.halfAId, 3);
    await settlements.completeAndSettle();
  });

  afterAll(async () => {
    await app.close();
  });

  test('only the owner admin can read it; staff and other roles cannot', async () => {
    for (const path of ['/owner/earnings/breakdown', '/owner/earnings/settlements']) {
      expect((await staff.get(path)).status).toBe(403);
      expect((await admin.get(path)).status).toBe(403);
      expect((await owner.get(path)).status).toBe(200);
    }
  });

  test('totals, venues and facilities add up and agree with each other', async () => {
    const { body } = await owner.get('/owner/earnings/breakdown');
    expect(body.total.bookings).toBe(4);
    const byVenue = body.byVenue as Row[];
    const byFacility = body.byFacility as Row[];
    const v1 = byVenue.find((v) => v.id === venue1.venueId)!;
    const v2 = byVenue.find((v) => v.id === venue2.venueId)!;
    expect([v1.bookings, v2.bookings]).toEqual([3, 1]);
    expect(byFacility.find((f) => f.id === footballCategory)!.bookings).toBe(3);
    expect(byFacility.find((f) => f.id === poolCategory)!.bookings).toBe(1);

    // Every row: what the customer paid is what the platform kept plus what the owner gets (nothing was refunded here).
    for (const r of [body.total as Row, ...byVenue, ...byFacility]) {
      expect(num(r.platform) + num(r.earned) + num(r.refunded)).toBeCloseTo(num(r.collected), 2);
    }
    // The venues, and the facilities, each add up to the total.
    const sum = (rows: Row[], key: keyof Row) => rows.reduce((s, r) => s + num(r[key] as string), 0);
    for (const key of ['collected', 'platform', 'earned'] as const) {
      expect(sum(byVenue, key)).toBeCloseTo(num((body.total as Row)[key]), 2);
      expect(sum(byFacility, key)).toBeCloseTo(num((body.total as Row)[key]), 2);
    }
    expect(num(v1.collected)).toBe(2400); // three bookings at 800 each
    expect(num(v2.collected)).toBe(800);
  });

  test('the period decides what counts: this month has nothing, last month has everything', async () => {
    const now = DateTime.now().setZone('Asia/Kolkata');
    const thisMonth = `from=${encodeURIComponent(now.startOf('month').toUTC().toISO()!)}`;
    const empty = (await owner.get(`/owner/earnings/breakdown?${thisMonth}`)).body;
    expect(empty.total.bookings).toBe(0);
    expect(empty.byVenue.length).toBeGreaterThanOrEqual(2); // venues are still listed, with zeros
    expect(empty.byVenue.every((v: Row) => v.bookings === 0 && num(v.earned) === 0)).toBe(true);

    const last = now.startOf('month').minus({ months: 1 });
    const range = `from=${encodeURIComponent(last.toUTC().toISO()!)}&to=${encodeURIComponent(now.startOf('month').toUTC().toISO()!)}`;
    expect((await owner.get(`/owner/earnings/breakdown?${range}`)).body.total.bookings).toBe(4);
  });

  test("another organisation sees none of it, and its own venues are listed with zeros", async () => {
    const { body } = await other.get('/owner/earnings/breakdown');
    expect(body.total.bookings).toBe(0);
    expect(body.byVenue.some((v: Row) => v.id === venue1.venueId)).toBe(false);
    expect((await other.get('/owner/earnings/settlements')).body).toEqual([]);
  });

  test('the bookings listing is paged and filtered by venue, facility, kind, search and date', async () => {
    const all = await owner.get('/owner/earnings/settlements?limit=100');
    expect(Number(all.headers['x-total-count'])).toBe(4);
    const first = all.body[0];
    expect(first).toMatchObject({ kind: 'PLAYED', currency: 'INR' });
    expect(first.booking.orderId).toBeTruthy();
    expect(first.venue.name).toBeTruthy();
    expect(first.category.name).toBeTruthy();
    expect(num(first.collected)).toBeCloseTo(num(first.platformAmount) + num(first.ownerAmount) + num(first.refunded), 2);

    const byVenue = await owner.get(`/owner/earnings/settlements?venueId=${venue2.venueId}`);
    expect(byVenue.body).toHaveLength(1);
    const byFacility = await owner.get(`/owner/earnings/settlements?categoryId=${poolCategory}`);
    expect(byFacility.body).toHaveLength(1);
    expect(byFacility.body[0].venue.id).toBe(venue1.venueId);
    expect((await owner.get('/owner/earnings/settlements?kind=LATE_CANCEL')).body).toHaveLength(0);

    const orderId = (await prisma.booking.findUniqueOrThrow({ where: { id: order.v1p } })).orderId;
    const bySearch = await owner.get(`/owner/earnings/settlements?search=${orderId}`);
    expect(bySearch.body).toHaveLength(1);
    expect(bySearch.body[0].booking.id).toBe(order.v1p);

    const p1 = (await owner.get('/owner/earnings/settlements?limit=2&offset=0')).body;
    const p2 = (await owner.get('/owner/earnings/settlements?limit=2&offset=2')).body;
    expect([...p1, ...p2].map((r: { id: string }) => r.id)).toEqual(all.body.map((r: { id: string }) => r.id));

    expect((await owner.get('/owner/earnings/settlements?kind=NOPE')).status).toBe(400);
    expect((await owner.get('/owner/earnings/settlements?venueId=not-a-uuid')).status).toBe(400);
    expect((await owner.get('/owner/earnings/settlements?from=nope')).status).toBe(400);
  });
});
