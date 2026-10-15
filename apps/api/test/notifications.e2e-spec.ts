import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
} from './setup/fixtures';

function signedWebhookRequest(app: INestApplication, payload: unknown, eventId: string) {
  const env = loadEnv();
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
  return request(app.getHttpServer())
    .post('/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .set('x-razorpay-event-id', eventId)
    .send(rawBody);
}

function capturedPayload(gatewayOrderId: string, gatewayPaymentId: string) {
  return {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: gatewayPaymentId, order_id: gatewayOrderId, amount: 80000, status: 'captured', currency: 'INR' },
      },
    },
  };
}

function failedPayload(gatewayOrderId: string) {
  return {
    event: 'payment.failed',
    payload: {
      payment: { entity: { order_id: gatewayOrderId, status: 'failed', error_description: 'Card declined' } },
    },
  };
}

/**
 * Owner notification center (persistent, in-app — see
 * apps/api/src/notifications/). Covers the service's own CRUD surface,
 * IDOR-safety of the owner-facing endpoints, the Super Admin
 * announcement endpoint's RBAC, and that every real booking/payment
 * lifecycle event this codebase actually has wires up a notification.
 */
describe('Owner notifications', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test('unauthenticated requests to every notification route are rejected', async () => {
    const http = app.getHttpServer();
    expect((await request(http).get('/owner/notifications')).status).toBe(401);
    expect((await request(http).get('/owner/notifications/unread-count')).status).toBe(401);
    expect((await request(http).patch('/owner/notifications/read-all')).status).toBe(401);
    expect((await request(http).post('/admin/notifications').send({})).status).toBe(401);
  });

  test('a non-Super-Admin cannot send an admin notification', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    const res = await ownerAgent.post('/admin/notifications').send({
      title: 'x',
      message: 'y',
      type: 'ADMIN_ANNOUNCEMENT',
      recipientType: 'ALL',
    });
    expect(res.status).toBe(403);
  });

  test('an owner cannot read or mark-read another owner\'s notification (IDOR)', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent: ownerA } = await createOwnerFixture(app, adminAgent);
    const { ownerAgent: ownerB, organizationId: orgB } = await createOwnerFixture(app, adminAgent);

    // Give owner B a real notification via the admin broadcast, then
    // confirm owner A can't touch it by id.
    const ownerBUser = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId: orgB } });
    const send = await adminAgent.post('/admin/notifications').send({
      title: 'For B only',
      message: 'Selected owner test',
      type: 'ADMIN_WARNING',
      recipientType: 'SELECTED',
      ownerIds: [ownerBUser.id],
    });
    expect(send.status).toBe(201);
    expect(send.body.recipientCount).toBe(1);

    const bList = await ownerB.get('/owner/notifications');
    expect(bList.status).toBe(200);
    const notificationId = bList.body.items[0].id as string;

    const forbidden = await ownerA.patch(`/owner/notifications/${notificationId}/read`).send({});
    expect(forbidden.status).toBe(404); // IDOR-safe: same response as "doesn't exist"

    // Owner B themself can mark it read.
    const ok = await ownerB.patch(`/owner/notifications/${notificationId}/read`).send({});
    expect(ok.status).toBe(200);
  });

  test('unread count, mark-all-as-read, and pagination behave correctly', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent, organizationId } = await createOwnerFixture(app, adminAgent);
    const ownerUser = await prisma.venueOwnerUser.findFirstOrThrow({ where: { organizationId } });

    const before = await ownerAgent.get('/owner/notifications/unread-count');
    expect(before.body.count).toBe(0);

    await prisma.ownerNotification.createMany({
      data: Array.from({ length: 3 }).map((_, i) => ({
        ownerId: ownerUser.id,
        type: 'SYSTEM' as const,
        title: `Test ${i}`,
        message: 'm',
      })),
    });

    const afterCreate = await ownerAgent.get('/owner/notifications/unread-count');
    expect(afterCreate.body.count).toBe(3);

    const markAll = await ownerAgent.patch('/owner/notifications/read-all').send({});
    expect(markAll.status).toBe(200);

    const afterMarkAll = await ownerAgent.get('/owner/notifications/unread-count');
    expect(afterMarkAll.body.count).toBe(0);

    const list = await ownerAgent.get('/owner/notifications?limit=2');
    expect(list.body.items).toHaveLength(2);
    expect(list.body.nextCursor).toBeTruthy();

    const nextPage = await ownerAgent.get(`/owner/notifications?limit=2&cursor=${list.body.nextCursor}`);
    expect(nextPage.body.items.length).toBeGreaterThan(0);
  });

  test('an admin announcement to ALL owners reaches every active owner', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent: ownerA } = await createOwnerFixture(app, adminAgent);
    const { ownerAgent: ownerB } = await createOwnerFixture(app, adminAgent);

    const res = await adminAgent.post('/admin/notifications').send({
      title: 'Scheduled maintenance',
      message: 'Down for 30 minutes tonight.',
      type: 'ADMIN_ANNOUNCEMENT',
      recipientType: 'ALL',
    });
    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBeGreaterThanOrEqual(2);

    const aList = await ownerA.get('/owner/notifications?limit=50');
    const bList = await ownerB.get('/owner/notifications?limit=50');
    expect(aList.body.items.some((n: { title: string }) => n.title === 'Scheduled maintenance')).toBe(true);
    expect(bList.body.items.some((n: { title: string }) => n.title === 'Scheduled maintenance')).toBe(true);
  });

  describe('booking/payment lifecycle integration', () => {
    let venue: Awaited<ReturnType<typeof createVenueFixture>>;
    let ownerAgent: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];

    beforeAll(async () => {
      const adminAgent = await loginAsSuperAdmin(app);
      const fixture = await createOwnerFixture(app, adminAgent);
      ownerAgent = fixture.ownerAgent;
      venue = await createVenueFixture(app, ownerAgent, adminAgent);
    });

    async function latestOwnerNotification() {
      const list = await ownerAgent.get('/owner/notifications?limit=1');
      return list.body.items[0];
    }

    test('booking created → BOOKING_CREATED notification', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const startTime = futureStart(20, 9).toISOString();
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
      expect(hold.status).toBe(201);

      const notification = await latestOwnerNotification();
      expect(notification.type).toBe('BOOKING_CREATED');
      expect(notification.data.bookingId).toBe(hold.body.id);
    });

    test('booking confirmed via payment webhook → consolidated BOOKING_CONFIRMED notification', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const startTime = futureStart(21, 9).toISOString();
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
      const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
      const gatewayOrderId = order.body.gatewayOrderId as string;

      const res = await signedWebhookRequest(
        app,
        capturedPayload(gatewayOrderId, `pay_${hold.body.id}`),
        `evt_notif_confirmed_${hold.body.id}`,
      );
      expect(res.status).toBe(200);

      const notification = await latestOwnerNotification();
      expect(notification.type).toBe('BOOKING_CONFIRMED');
      expect(notification.data.bookingId).toBe(hold.body.id);

      // Exactly one BOOKING_CONFIRMED for this booking — not a separate
      // PAYMENT_RECEIVED row too (consolidated per design decision). A
      // BOOKING_CREATED row for the same bookingId also exists (from the
      // hold itself) — that's correct, distinct-type behavior, not a
      // duplicate.
      const all = await ownerAgent.get('/owner/notifications?limit=50');
      const confirmedForThisBooking = all.body.items.filter(
        (n: { type: string; data: { bookingId: string } }) =>
          n.data?.bookingId === hold.body.id && n.type === 'BOOKING_CONFIRMED',
      );
      expect(confirmedForThisBooking).toHaveLength(1);
    });

    test('payment failed → PAYMENT_FAILED notification', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const startTime = futureStart(22, 9).toISOString();
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
      const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
      const gatewayOrderId = order.body.gatewayOrderId as string;

      const res = await signedWebhookRequest(
        app,
        failedPayload(gatewayOrderId),
        `evt_notif_failed_${hold.body.id}`,
      );
      expect(res.status).toBe(200);

      const notification = await latestOwnerNotification();
      expect(notification.type).toBe('PAYMENT_FAILED');
      expect(notification.data.bookingId).toBe(hold.body.id);
    });

    test('booking cancelled → BOOKING_CANCELLED notification', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const startTime = futureStart(23, 9).toISOString();
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });

      const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({});
      expect(cancel.status).toBe(201);

      const notification = await latestOwnerNotification();
      expect(notification.type).toBe('BOOKING_CANCELLED');
      expect(notification.data.bookingId).toBe(hold.body.id);
    });

    test('duplicate webhook delivery does not create a duplicate notification', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const startTime = futureStart(24, 9).toISOString();
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
      const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
      const gatewayOrderId = order.body.gatewayOrderId as string;
      const payload = capturedPayload(gatewayOrderId, `pay_dup_${hold.body.id}`);
      const eventId = `evt_notif_dup_${hold.body.id}`;

      const first = await signedWebhookRequest(app, payload, eventId);
      expect(first.status).toBe(200);
      const second = await signedWebhookRequest(app, payload, eventId);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ status: 'duplicate' });

      const all = await ownerAgent.get('/owner/notifications?limit=100');
      const confirmedForThisBooking = all.body.items.filter(
        (n: { type: string; data: { bookingId: string } }) =>
          n.data?.bookingId === hold.body.id && n.type === 'BOOKING_CONFIRMED',
      );
      expect(confirmedForThisBooking).toHaveLength(1);
    });
  });
});
