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
 * Owner-configured blackouts (ARCHITECTURE.md's Phase 10 notes):
 * BlockedDate previously existed in the schema but was enforced nowhere
 * — creating one was purely cosmetic until this phase wired it into
 * both the availability search and `createHold`. Formalizes the manual
 * curl verification of both branches: a venue-wide block (resourceId
 * null) affects every resource, a resource-specific block affects only
 * its own resource.
 */
describe('Owner-configured blocked dates', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let ownerAgent: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const owner = await createOwnerFixture(app, adminAgent);
    ownerAgent = owner.ownerAgent;
    venue = await createVenueFixture(app, owner.ownerAgent, adminAgent);
  });

  afterAll(async () => {
    await app.close();
  });

  test('a venue-wide block rejects a hold on every resource during that window', async () => {
    const startTime = futureStart(25, 10);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

    const block = await ownerAgent.post('/venue-config/blocked-dates').send({
      venueId: venue.venueId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      reason: 'e2e venue-wide block',
    });
    expect(block.status).toBe(201);

    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);

    const holdA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(holdA.status).toBe(409);

    const holdB = await customerB
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(holdB.status).toBe(409);

    await ownerAgent.delete(`/venue-config/blocked-dates/${block.body.id}`);
  });

  test('a resource-specific block only rejects holds on that resource', async () => {
    const startTime = futureStart(26, 10);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

    const block = await ownerAgent.post('/venue-config/blocked-dates').send({
      venueId: venue.venueId,
      resourceId: venue.halfAId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      reason: 'e2e resource-specific block',
    });
    expect(block.status).toBe(201);

    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);

    const holdA = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(holdA.status).toBe(409);

    const holdB = await customerB
      .post('/bookings/hold')
      .send({ resourceId: venue.halfBId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(holdB.status).toBe(201);
  });

  test('removing a blocked date makes the resource bookable again', async () => {
    const startTime = futureStart(27, 10);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

    const block = await ownerAgent.post('/venue-config/blocked-dates').send({
      venueId: venue.venueId,
      resourceId: venue.halfAId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    });
    expect(block.status).toBe(201);

    const { agent: customer } = await createCustomerFixture(app);
    const blockedAttempt = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(blockedAttempt.status).toBe(409);

    const del = await ownerAgent.delete(`/venue-config/blocked-dates/${block.body.id}`);
    expect(del.status).toBe(200);

    const { agent: otherCustomer } = await createCustomerFixture(app);
    const afterRemoval = await otherCustomer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(afterRemoval.status).toBe(201);
  });
});
