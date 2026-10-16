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
 * The website checkout page is built from GET /me/bookings/:id, so that
 * response must say which venue the booking is at and until when the slot
 * is held — and must never expose another customer's booking.
 */
describe('Customer booking view (checkout page data)', () => {
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

  test('returns the venue and the hold expiry alongside the booking', async () => {
    const { agent } = await createCustomerFixture(app);
    const hold = await agent.post('/bookings/hold').send({
      resourceId: venue.halfAId,
      startTime: futureStart(6, 10).toISOString(),
      durationMinutes: 60,
    });
    expect(hold.status).toBe(201);

    const res = await agent.get(`/me/bookings/${hold.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(hold.body.id);
    expect(res.body.status).toBe('PENDING_PAYMENT');
    expect(res.body.venue).toEqual(
      expect.objectContaining({ name: expect.stringContaining('E2E Venue'), address: '1 Test Lane' }),
    );
    expect(res.body.resourceName).toBe('5s Half A');
    const expiresAt = new Date(res.body.holdExpiresAt).getTime();
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThan(Date.now() + 60 * 60 * 1000);
  });

  test("another customer cannot read someone else's booking", async () => {
    const { agent: owner } = await createCustomerFixture(app);
    const { agent: stranger } = await createCustomerFixture(app);
    const hold = await owner.post('/bookings/hold').send({
      resourceId: venue.halfBId,
      startTime: futureStart(7, 10).toISOString(),
      durationMinutes: 60,
    });
    expect(hold.status).toBe(201);

    const res = await stranger.get(`/me/bookings/${hold.body.id}`);

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('E2E Venue');
  });
});
