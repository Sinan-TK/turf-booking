import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

/** An id in the address that is not an id is a plain 400 ("bad request"), never a database error (500). */
describe('Malformed ids in the address', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let customer: TestAgent;
  const bad = 'undefined';
  const missing = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    ({ ownerAgent: owner } = await createOwnerFixture(app, admin));
    ({ agent: customer } = await createCustomerFixture(app));
  });

  afterAll(async () => {
    await app.close();
  });

  test('a customer asking about a booking, paying for it or cancelling it', async () => {
    for (const call of [
      () => customer.post(`/bookings/${bad}/pay-with-coins`).send({}),
      () => customer.get(`/me/bookings/${bad}`),
      () => customer.post(`/me/bookings/${bad}/cancel`).send({}),
      () => customer.delete(`/me/saved-venues/${bad}`),
    ]) {
      expect((await call()).status).toBe(400);
    }
    // A well-formed id that does not exist is still a 404, not a 400.
    expect((await customer.get(`/me/bookings/${missing}`)).status).toBe(404);
  });

  test('the owner and the Super Admin asking about venues, bookings, tickets, organisations and customers', async () => {
    for (const call of [
      () => owner.get(`/venues/${bad}`),
      () => owner.patch(`/venues/${bad}`).send({}),
      () => owner.get(`/owner/bookings/${bad}`),
      () => owner.post(`/owner/bookings/${bad}/cancel`).send({}),
      () => owner.delete(`/venue-config/pricing-rules/${bad}`),
      () => admin.get(`/admin/customers/${bad}`),
      () => admin.get(`/admin/organizations/${bad}`),
      () => admin.patch(`/admin/organizations/${bad}/status`).send({ status: 'SUSPENDED' }),
      () => admin.get(`/admin/bookings/${bad}`),
      () => admin.get(`/admin/support/tickets/${bad}`),
    ]) {
      const res = await call();
      expect([400, 404]).toContain(res.status); // a route that does not exist is a 404; none of them may be a server error
      expect(res.status).toBeLessThan(500);
    }
    expect((await owner.get(`/venues/${bad}`)).status).toBe(400);
    expect((await owner.get(`/venues/${missing}`)).status).toBe(404);
  });
});
