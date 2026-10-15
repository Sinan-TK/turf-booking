import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
} from './setup/fixtures';

/**
 * RBAC boundary tests (ARCHITECTURE.md §12): every role only ever sees
 * its own data, and the three identity types (Super Admin, Venue Owner,
 * Customer) can never reach each other's endpoints. Formalizes the
 * manual curl checks run throughout Phases 9-10 (401 unauthenticated,
 * 403 wrong role, 403/empty cross-organization).
 */
describe('Auth & RBAC boundaries', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('an invalid/missing bearer token is rejected on an admin-only route', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/admin/me')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  test('there is no public route to mint a customer session for an arbitrary phone number', async () => {
    const res = await request(app.getHttpServer())
      .post('/booking-sessions')
      .send({ whatsappNumber: '+919999912345' });
    expect(res.status).toBe(404);
  });

  test('unauthenticated request to an admin-only route is rejected', async () => {
    const res = await request(app.getHttpServer()).get('/admin/organizations');
    expect(res.status).toBe(401);
  });

  test('an authenticated Venue Owner cannot reach a Super-Admin-only route', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);

    const res = await ownerAgent.post('/admin/organizations').send({
      name: 'Should not be creatable',
      contactEmail: 'nope@example.com',
      contactPhone: '+910000000000',
    });
    expect(res.status).toBe(403);
  });

  test('an authenticated Customer cannot reach an owner-only route', async () => {
    const { agent: customerAgent } = await createCustomerFixture(app);
    const res = await customerAgent.get('/owner/bookings');
    expect(res.status).toBe(403);
  });

  test('two owners in different organizations cannot see or touch each other\'s data', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent: ownerAAgent } = await createOwnerFixture(app, adminAgent);
    const { ownerAgent: ownerBAgent } = await createOwnerFixture(app, adminAgent);
    const venueA = await createVenueFixture(app, ownerAAgent, adminAgent);

    // Owner B's own booking list must never contain Owner A's venue data.
    const listRes = await ownerBAgent.get('/owner/bookings');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((b: { venue: { id: string } }) => b.venue?.id === venueA.venueId)).toBe(false);

    // Owner B cannot write configuration onto Owner A's venue.
    const configRes = await ownerBAgent
      .put('/venue-config/operating-hours')
      .send({ venueId: venueA.venueId, weekday: 1, openTime: '01:00', closeTime: '02:00' });
    expect(configRes.status).toBe(403);

    // Owner B cannot even read Owner A's venue as "mine".
    const getVenueRes = await ownerBAgent.get(`/venues/${venueA.venueId}`);
    expect(getVenueRes.status).toBe(403);

    // Nor enumerate Owner A's resources or resource groups by venueId.
    expect((await ownerBAgent.get(`/resources?venueId=${venueA.venueId}`)).status).toBe(403);
    expect((await ownerBAgent.get(`/resources/groups?venueId=${venueA.venueId}`)).status).toBe(403);
    // ...while Owner A (and a Super Admin) still can.
    const own = await ownerAAgent.get(`/resources?venueId=${venueA.venueId}`);
    expect(own.status).toBe(200);
    expect(own.body.length).toBeGreaterThan(0);
    expect((await adminAgent.get(`/resources/groups?venueId=${venueA.venueId}`)).status).toBe(200);
  });

  test('a customer cannot cancel another customer\'s booking', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    const venue = await createVenueFixture(app, ownerAgent, adminAgent);

    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);

    const startTime = futureStart(10, 9);

    const hold = await customerA
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime: startTime.toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);

    const cancelAttempt = await customerB.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(cancelAttempt.status).toBe(403);
  });
});
