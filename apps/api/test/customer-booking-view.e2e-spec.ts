import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, futureStart, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

/** What the customer's booking page is given: which venue, where, and exactly what was booked. */
describe('Customer booking view', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, admin);
    venue = await createVenueFixture(app, ownerAgent, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  test('carries the venue, its address and map details, the unit that was booked and its facility', async () => {
    const { agent } = await createCustomerFixture(app);
    const hold = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: futureStart(9, 10).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);

    const view = await agent.get(`/me/bookings/${hold.body.id}`);
    expect(view.status).toBe(200);
    const row = await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } });
    expect(view.body.venue).toMatchObject({ id: venue.venueId, name: row.name, address: row.address, facilityCode: row.facilityCode });
    expect(typeof view.body.venue.lat).toBe('number'); // coordinates arrive as numbers, ready for a directions link
    expect(typeof view.body.venue.lng).toBe('number');
    expect(view.body).toHaveProperty('venue.googleMapsUrl');
    expect(view.body.resourceName).toBe('5s Half A');
    const football = await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'FOOTBALL_TURF' } });
    expect(view.body.facility).toEqual({ name: football.name, unitLabel: football.unitLabel });
    // What the earlier page already relied on is still there.
    expect(view.body).toMatchObject({ id: hold.body.id, orderId: hold.body.orderId, status: 'PENDING_PAYMENT', groundType: '5S' });
    expect(view.body.holdExpiresAt).toBeTruthy();
    expect(view.body).not.toHaveProperty('resource');
    expect(view.body).not.toHaveProperty('resourceGroup');
  });

  test("another customer's booking is refused", async () => {
    const mine = await createCustomerFixture(app);
    const theirs = await createCustomerFixture(app);
    const hold = await mine.agent.post('/bookings/hold').send({ resourceId: venue.halfBId, startTime: futureStart(9, 12).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect((await theirs.agent.get(`/me/bookings/${hold.body.id}`)).status).toBe(403);
  });
});
