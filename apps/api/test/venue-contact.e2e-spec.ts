import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, futureStart, loginAsSuperAdmin, prisma } from './setup/fixtures';

/**
 * A venue's contact number: set by its owner, falls back to the owner organization's number, and reaches only a customer whose booking
 * is confirmed (never the public venue lookup, never a pending or cancelled booking).
 */
describe('Venue contact number', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let ownerAgent: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];
  let organizationId: string;
  let day = 3;

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const owner = await createOwnerFixture(app, adminAgent);
    ownerAgent = owner.ownerAgent;
    organizationId = owner.organizationId;
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
  });
  afterAll(async () => {
    await app.close();
  });

  function confirmByWebhook(orderId: string, amountMinor: number) {
    const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_${orderId}`, order_id: orderId, amount: amountMinor, status: 'captured', currency: 'INR' } } } });
    const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
    return request(app.getHttpServer()).post('/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).set('x-razorpay-event-id', `evt_${orderId}`).send(rawBody);
  }
  async function booking() {
    const { agent } = await createCustomerFixture(app);
    const hold = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: futureStart(day++, 9).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    return { agent, id: hold.body.id as string };
  }
  async function pay(b: { agent: Awaited<ReturnType<typeof createCustomerFixture>>['agent']; id: string }) {
    const order = await b.agent.post('/payments/create-order').send({ bookingId: b.id });
    await confirmByWebhook(order.body.gatewayOrderId, Math.round(Number(order.body.amount) * 100));
  }

  test("a confirmed booking shows the venue's own number; clearing it falls back to the organization's number", async () => {
    const set = await ownerAgent.patch(`/venues/${venue.venueId}`).send({ contactPhone: '9847012345' });
    expect(set.status).toBe(200);
    const stored = (await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } })).contactPhone;
    expect(stored).toMatch(/9847012345$/);

    const b = await booking();
    await pay(b);
    const view = await b.agent.get(`/me/bookings/${b.id}`);
    expect(view.status).toBe(200);
    expect(view.body.venue.contactPhone).toBe(stored);

    await ownerAgent.patch(`/venues/${venue.venueId}`).send({ contactPhone: '' });
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } })).contactPhone).toBeNull();
    const org = await prisma.ownerOrganization.findUniqueOrThrow({ where: { id: organizationId } });
    const view2 = await b.agent.get(`/me/bookings/${b.id}`);
    expect(view2.body.venue.contactPhone).toBe(org.contactPhone);
  });

  test('an unpaid (pending) booking does not carry the number', async () => {
    const b = await booking();
    const view = await b.agent.get(`/me/bookings/${b.id}`);
    expect(view.body.venue.contactPhone).toBeNull();
  });

  test('a cancelled booking does not carry the number', async () => {
    const b = await booking();
    await pay(b);
    expect((await b.agent.post(`/me/bookings/${b.id}/cancel`).send({})).status).toBe(201);
    expect((await b.agent.get(`/me/bookings/${b.id}`)).body.venue.contactPhone).toBeNull();
  });

  test('the public venue lookup never returns it', async () => {
    await ownerAgent.patch(`/venues/${venue.venueId}`).send({ contactPhone: '9847012345' });
    const code = (await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } })).facilityCode;
    const res = await request(app.getHttpServer()).get(`/venues/by-code/${code}`);
    expect(res.status).toBe(200);
    expect(res.body.contactPhone).toBeUndefined();
  });

  test('a number that is not an Indian mobile number is refused', async () => {
    const res = await ownerAgent.patch(`/venues/${venue.venueId}`).send({ contactPhone: '12345' });
    expect(res.status).toBe(400);
  });

  test("another customer cannot read someone else's booking (so not its number)", async () => {
    const b = await booking();
    await pay(b);
    const { agent: stranger } = await createCustomerFixture(app);
    expect((await stranger.get(`/me/bookings/${b.id}`)).status).toBe(403);
  });
});
