import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, futureStart, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

/**
 * Booking lists: the newest booking first by default (the customer's, the owner's and the admin's), and the owner and admin lists
 * can be sorted by any column, both ways, with the same rows on every page.
 */
describe('Booking lists: newest first, and sorting by column', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let admin: TestAgent;
  let organizationId: string;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  // Made in this order, but starting on different days and for different prices.
  const made: Array<{ id: string; orderId: string; amount: number; day: number }> = [];

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const o = await createOwnerFixture(app, admin);
    owner = o.ownerAgent;
    organizationId = o.organizationId;
    venue = await createVenueFixture(app, owner, admin);
    for (const [i, { day, amount }] of [
      { day: 6, amount: 300 },
      { day: 3, amount: 100 },
      { day: 5, amount: 200 },
    ].entries()) {
      const res = await owner
        .post('/owner/bookings')
        .send({
          resourceId: venue.fullGroundId,
          durationMinutes: 60,
          customerWhatsappNumber: `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          customerName: `Sort ${String.fromCharCode(65 + i)}`,
          amount,
          startTime: futureStart(day, 10).toISOString(),
        })
        .expect(201);
      made.push({ id: res.body.id, orderId: res.body.orderId, amount, day });
    }
  });
  afterAll(async () => app.close());

  const ids = (body: Array<{ id: string }>) => body.map((b) => b.id);
  const [first, second, third] = [() => made[0]!.id, () => made[1]!.id, () => made[2]!.id];

  it('the owner and the admin see the newest booking first by default', async () => {
    const expected = [third(), second(), first()];
    expect(ids((await owner.get('/owner/bookings').expect(200)).body)).toEqual(expected);
    expect(ids((await admin.get(`/admin/bookings?organizationId=${organizationId}`).expect(200)).body)).toEqual(expected);
  });

  it('sorts by start time, amount and order number, both ways', async () => {
    const get = async (qs: string) => ids((await owner.get(`/owner/bookings?${qs}`).expect(200)).body);
    // starts: day 6 (first), day 3 (second), day 5 (third)
    expect(await get('sort=start&dir=asc')).toEqual([second(), third(), first()]);
    expect(await get('sort=start&dir=desc')).toEqual([first(), third(), second()]);
    // amounts: 300, 100, 200
    expect(await get('sort=amount&dir=asc')).toEqual([second(), third(), first()]);
    expect(await get('sort=amount&dir=desc')).toEqual([first(), third(), second()]);
    // order numbers rise with creation
    expect(await get('sort=order&dir=asc')).toEqual([first(), second(), third()]);
    expect(await get('sort=order&dir=desc')).toEqual([third(), second(), first()]);
    expect(await get('sort=created&dir=asc')).toEqual([first(), second(), third()]);
    // customers were named Sort A, B, C in creation order
    expect(await get('sort=customer&dir=asc')).toEqual([first(), second(), third()]);
    expect(await get('sort=customer&dir=desc')).toEqual([third(), second(), first()]);
    // a column alone, with no direction, still has the newest/biggest first
    expect(await get('sort=amount')).toEqual([first(), third(), second()]);
    // venue and status are accepted too
    await owner.get('/owner/bookings?sort=venue&dir=asc').expect(200);
    await owner.get('/owner/bookings?sort=status&dir=desc').expect(200);
  });

  it('the admin list sorts the same way, and a sorted list pages without repeating or skipping a row', async () => {
    const get = async (qs: string) => ids((await admin.get(`/admin/bookings?organizationId=${organizationId}&${qs}`).expect(200)).body);
    expect(await get('sort=start&dir=asc')).toEqual([second(), third(), first()]);
    expect(await get('sort=amount&dir=desc')).toEqual([first(), third(), second()]);
    const pages = [
      ...(await get('sort=start&dir=asc&limit=1&offset=0')),
      ...(await get('sort=start&dir=asc&limit=1&offset=1')),
      ...(await get('sort=start&dir=asc&limit=1&offset=2')),
    ];
    expect(pages).toEqual([second(), third(), first()]);
  });

  it('an unknown column or direction is refused', async () => {
    expect((await owner.get('/owner/bookings?sort=password')).status).toBe(400);
    expect((await owner.get('/owner/bookings?sort=start&dir=sideways')).status).toBe(400);
    expect((await admin.get('/admin/bookings?sort=nope')).status).toBe(400);
  });

  it("a customer's My bookings has the newest booking first", async () => {
    const { agent } = await createCustomerFixture(app);
    const a = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: futureStart(9, 9).toISOString(), durationMinutes: 60 });
    expect(a.status).toBe(201);
    const b = await agent.post('/bookings/hold').send({ resourceId: venue.halfBId ?? venue.halfAId, startTime: futureStart(4, 9).toISOString(), durationMinutes: 60 });
    expect(b.status).toBe(201);
    const mine = await agent.get('/me/bookings').expect(200);
    // b was made last (though it starts earlier), so it comes first.
    expect(ids(mine.body)).toEqual([b.body.id, a.body.id]);
  });
});
