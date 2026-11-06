import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp, fakeGateway } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, futureStart, loginAsSuperAdmin, prisma } from './setup/fixtures';
import { PaymentsService } from '../src/payments/payments.service';

/**
 * Opening the payment popup: the booking turns PROCESSING at once (the slot locked for the 5-minute window, nothing paid yet),
 * goes back to pending when the popup is closed, is confirmed when the payment is captured, and fails when the window ends with nothing.
 */
describe('Payment popup attempt: PENDING_PAYMENT -> PROCESSING', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let day = 3;

  beforeAll(async () => {
    app = await createTestApp();
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => fakeGateway.reset());

  const webhook = (payload: unknown, eventId: string) => {
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
    return request(app.getHttpServer()).post('/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).set('x-razorpay-event-id', eventId).send(rawBody);
  };
  const clientSignature = (orderId: string, paymentId: string) => createHmac('sha256', loadEnv().RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');
  const bookingOf = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
  const paymentOf = (orderId: string) => prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId: orderId } });

  async function start() {
    const { agent, customerId } = await createCustomerFixture(app);
    await prisma.customerProfile.update({ where: { id: customerId }, data: { phoneVerified: true } });
    const startTime = futureStart(day++, 9).toISOString();
    const hold = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    return { agent, startTime, bookingId: hold.body.id as string, slotHoldId: hold.body.slotHoldId as string };
  }
  async function open() {
    const c = await start();
    const order = await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
    expect(order.status).toBe(201);
    return { ...c, orderId: order.body.gatewayOrderId as string, amountMinor: Math.round(Number(order.body.amount) * 100), order: order.body };
  }

  test('clicking pay online makes the booking PROCESSING with a 5-minute window and the slot locked; the payment is still only pending', async () => {
    const c = await open();
    const booking = await bookingOf(c.bookingId);
    expect(booking.status).toBe('PROCESSING');
    const left = booking.processingUntil!.getTime() - Date.now();
    expect(left).toBeGreaterThan(4 * 60_000);
    expect(left).toBeLessThanOrEqual(5 * 60_000);
    expect(new Date(c.order.processingUntil).getTime()).toBe(booking.processingUntil!.getTime());
    expect((await paymentOf(c.orderId)).status).toBe('PENDING');
    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: c.slotHoldId } })).holdExpiresAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    // The customer's own view says so.
    expect((await c.agent.get(`/me/bookings/${c.bookingId}`)).body.status).toBe('PROCESSING');
    // And nobody else can take the slot meanwhile.
    const { agent: other } = await createCustomerFixture(app);
    expect((await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: c.startTime, durationMinutes: 60 })).status).toBe(409);
  });

  test('clicking again reuses the same order and the booking stays PROCESSING', async () => {
    const c = await open();
    const again = await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
    expect(again.status).toBe(201);
    expect(again.body.gatewayOrderId).toBe(c.orderId);
    expect(again.body.reused).toBe(true);
    expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
    expect(await prisma.payment.count({ where: { bookingId: c.bookingId } })).toBe(1);
  });

  test('closing the popup puts the booking back to pending (slot kept); doing it twice, or for someone else, changes nothing more', async () => {
    const c = await open();
    const back = await c.agent.post('/payments/cancel-attempt').send({ bookingId: c.bookingId });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('PENDING_PAYMENT');
    const booking = await bookingOf(c.bookingId);
    expect(booking.status).toBe('PENDING_PAYMENT');
    expect(booking.processingUntil).toBeNull();
    expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: c.slotHoldId } })).status).toBe('HELD');
    expect((await c.agent.post('/payments/cancel-attempt').send({ bookingId: c.bookingId })).body.status).toBe('PENDING_PAYMENT');
    const { agent: stranger } = await createCustomerFixture(app);
    expect((await stranger.post('/payments/cancel-attempt').send({ bookingId: c.bookingId })).status).toBe(403);
    // They can open the popup again afterwards: same order.
    const reopened = await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
    expect(reopened.body.gatewayOrderId).toBe(c.orderId);
    expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
  });

  test('once the customer has reported a payment, closing the popup no longer puts the booking back', async () => {
    const c = await open();
    const pid = `pay_rep_${c.bookingId.slice(0, 8)}`;
    await c.agent.post('/payments/verify').send({ razorpayOrderId: c.orderId, razorpayPaymentId: pid, razorpaySignature: clientSignature(c.orderId, pid) });
    expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
    expect((await c.agent.post('/payments/cancel-attempt').send({ bookingId: c.bookingId })).body.status).toBe('PROCESSING');
    expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
    expect((await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId })).status).toBe(409);
  });

  test('the payment is captured while the booking is PROCESSING (webhook, customer offline): it is confirmed', async () => {
    const c = await open();
    const res = await webhook(
      { event: 'payment.captured', payload: { payment: { entity: { id: `pay_cap_${c.bookingId.slice(0, 8)}`, order_id: c.orderId, amount: c.amountMinor, status: 'captured', currency: 'INR' } } } },
      `evt_cap_${c.bookingId}`,
    );
    expect(res.status).toBe(200);
    const booking = await bookingOf(c.bookingId);
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.processingUntil).toBeNull();
    expect((await paymentOf(c.orderId)).status).toBe('SUCCESS');
  });

  test('a declined card during the attempt does not end it: the booking stays PROCESSING and a retry that is captured confirms it', async () => {
    const c = await open();
    await webhook({ event: 'payment.failed', payload: { payment: { entity: { order_id: c.orderId, status: 'failed', error_description: 'Card declined' } } } }, `evt_decl_${c.bookingId}`);
    expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
    expect((await paymentOf(c.orderId)).status).toBe('PENDING');
    await webhook(
      { event: 'payment.captured', payload: { payment: { entity: { id: `pay_retry_${c.bookingId.slice(0, 8)}`, order_id: c.orderId, amount: c.amountMinor, status: 'captured', currency: 'INR' } } } },
      `evt_retry2_${c.bookingId}`,
    );
    expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
  });

  test('the window ends with nothing captured (popup left open, internet gone): the booking fails and the slot is free again', async () => {
    const c = await open();
    await prisma.booking.update({ where: { id: c.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });
    await app.get(PaymentsService).reconcileProcessing();
    const booking = await bookingOf(c.bookingId);
    expect(booking.status).toBe('FAILED');
    expect((await paymentOf(c.orderId)).status).toBe('EXPIRED');
    const { agent: other } = await createCustomerFixture(app);
    expect((await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: c.startTime, durationMinutes: 60 })).status).toBe(201);
  });

  test('the window ends but the gateway did capture the payment: it is confirmed, not failed', async () => {
    const c = await open();
    fakeGateway.capture(c.orderId, c.amountMinor);
    await prisma.booking.update({ where: { id: c.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });
    await app.get(PaymentsService).reconcileProcessing();
    expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
  });

  test('a booking whose slot hold has already run out cannot open the popup', async () => {
    const c = await start();
    await prisma.slotHold.update({ where: { id: c.slotHoldId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    expect((await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId })).status).toBe(409);
    expect((await bookingOf(c.bookingId)).status).toBe('PENDING_PAYMENT');
  });
});
