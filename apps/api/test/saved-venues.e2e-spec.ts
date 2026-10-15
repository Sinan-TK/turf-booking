import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, loginAsSuperAdmin } from './setup/fixtures';

/**
 * A customer's saved/favorited venues (apps/api/src/saved-venues/) — the
 * shortcut the WhatsApp "Book a Venue" menu (whatsapp-menu.service.ts's
 * startBookVenueFlow) and the web app's search results both offer.
 */
describe('Saved venues', () => {
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

  test('unauthenticated requests are rejected', async () => {
    const http = app.getHttpServer();
    expect((await request(http).get('/me/saved-venues')).status).toBe(401);
    expect((await request(http).post('/me/saved-venues').send({ venueId: venue.venueId })).status).toBe(401);
    expect((await request(http).delete(`/me/saved-venues/${venue.venueId}`)).status).toBe(401);
  });

  test('a customer can save, list, and unsave a venue', async () => {
    const { agent: customer } = await createCustomerFixture(app);

    const empty = await customer.get('/me/saved-venues');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const save = await customer.post('/me/saved-venues').send({ venueId: venue.venueId });
    expect(save.status).toBe(201);

    const afterSave = await customer.get('/me/saved-venues');
    expect(afterSave.body).toHaveLength(1);
    expect(afterSave.body[0].id).toBe(venue.venueId);

    // Idempotent: saving the same venue again is a no-op, not an error
    // or a duplicate row.
    const saveAgain = await customer.post('/me/saved-venues').send({ venueId: venue.venueId });
    expect(saveAgain.status).toBe(201);
    const afterSaveAgain = await customer.get('/me/saved-venues');
    expect(afterSaveAgain.body).toHaveLength(1);

    const unsave = await customer.delete(`/me/saved-venues/${venue.venueId}`);
    expect(unsave.status).toBe(200);
    const afterUnsave = await customer.get('/me/saved-venues');
    expect(afterUnsave.body).toEqual([]);
  });

  test('saving a nonexistent venue 404s', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const res = await customer
      .post('/me/saved-venues')
      .send({ venueId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(404);
  });

  test('one customer never sees another customer\'s saved venues', async () => {
    const { agent: customerA } = await createCustomerFixture(app);
    const { agent: customerB } = await createCustomerFixture(app);

    await customerA.post('/me/saved-venues').send({ venueId: venue.venueId });

    const aList = await customerA.get('/me/saved-venues');
    const bList = await customerB.get('/me/saved-venues');
    expect(aList.body).toHaveLength(1);
    expect(bList.body).toEqual([]);
  });
});
