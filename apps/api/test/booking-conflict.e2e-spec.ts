import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
} from './setup/fixtures';

/**
 * The single most important correctness property in the whole system
 * (ARCHITECTURE.md §6): booking one 5s half must block that half AND the
 * 7s full ground, but NOT the other 5s half — and it must hold up under
 * real concurrent requests, not just sequential ones. This formalizes
 * the manual curl/psql verification from Phase 5's live testing
 * (including the footprint-vs-closure bug found and fixed there) as a
 * durable regression test.
 */
describe('Booking conflict rules (footprint locking)', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
  });

  afterAll(async () => {
    await app.close();
  });

  test('booking 5s Half A does not block 5s Half B at the same time', async () => {
    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);
    const startTime = futureStart(3, 10).toISOString();

    const bookA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(bookA.status).toBe(201);
    expect(bookA.body.status).toBe('PENDING_PAYMENT');

    const bookB = await customerB
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime, durationMinutes: 60 });
    expect(bookB.status).toBe(201);
  });

  test('booking both halves blocks the 7s full ground at that time', async () => {
    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);
    const { agent: customerFull } = await createCustomerFixture(app);
    const startTime = futureStart(4, 10).toISOString();

    const bookA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(bookA.status).toBe(201);

    const bookB = await customerB
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime, durationMinutes: 60 });
    expect(bookB.status).toBe(201);

    const bookFull = await customerFull
      .post('/bookings/hold')
      .send({ resourceId: venue.fullGroundId, startTime, durationMinutes: 60 });
    expect(bookFull.status).toBe(409);
  });

  test('booking only Half A already blocks the full ground (footprint overlap)', async () => {
    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerFull } = await createCustomerFixture(app);
    const startTime = futureStart(5, 10).toISOString();

    const bookA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(bookA.status).toBe(201);

    const bookFull = await customerFull
      .post('/bookings/hold')
      .send({ resourceId: venue.fullGroundId, startTime, durationMinutes: 60 });
    expect(bookFull.status).toBe(409);
  });

  test('booking the full ground first blocks both halves', async () => {
    const { agent: customerFull } = await createCustomerFixture(app);
    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);
    const startTime = futureStart(6, 10).toISOString();

    const bookFull = await customerFull
      .post('/bookings/hold')
      .send({ resourceId: venue.fullGroundId, startTime, durationMinutes: 60 });
    expect(bookFull.status).toBe(201);

    const bookA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(bookA.status).toBe(409);

    const bookB = await customerB
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime, durationMinutes: 60 });
    expect(bookB.status).toBe(409);
  });

  test('two concurrent requests for the exact same resource/time: exactly one wins', async () => {
    const { agent: customer1 } = await createCustomerFixture(app);
    const { agent: customer2 } = await createCustomerFixture(app);
    const startTime = futureStart(7, 10).toISOString();

    const [res1, res2] = await Promise.all([
      customer1.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 }),
      customer2.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
