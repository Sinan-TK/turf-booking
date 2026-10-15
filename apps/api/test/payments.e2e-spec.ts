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
import { ExpiryService } from '../src/jobs/expiry.service';

function signedWebhookRequest(
  app: INestApplication,
  payload: unknown,
  eventId: string,
  opts: { badSignature?: boolean } = {},
) {
  const env = loadEnv();
  const rawBody = JSON.stringify(payload);
  const signature = opts.badSignature
    ? '0'.repeat(64)
    : createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
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
        entity: {
          id: gatewayPaymentId,
          order_id: gatewayOrderId,
          amount: 80000,
          status: 'captured',
          currency: 'INR',
        },
      },
    },
  };
}

function failedPayload(gatewayOrderId: string) {
  return {
    event: 'payment.failed',
    payload: {
      payment: {
        entity: {
          order_id: gatewayOrderId,
          status: 'failed',
          error_description: 'Card declined',
        },
      },
    },
  };
}

/**
 * Payment flow (ARCHITECTURE.md §9): the webhook, never the browser
 * redirect, is the only thing that ever confirms a booking. Formalizes
 * Phase 6's manual self-signed-curl testing — including the specific
 * duplicate-webhook and "payment confirmed too late" edge cases that
 * were the whole point of that design.
 */
describe('Payment flow', () => {
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

  test('a captured webhook confirms the booking and payment', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(10, 9).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);

    const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
    expect(order.status).toBe(201);
    const gatewayOrderId = order.body.gatewayOrderId as string;

    const eventId = `evt_captured_${hold.body.id}`;
    const res = await signedWebhookRequest(
      app,
      capturedPayload(gatewayOrderId, `pay_${hold.body.id}`),
      eventId,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.paymentMethod).toBe('MONEY');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId } });
    expect(payment.status).toBe('SUCCESS');

    const slotHold = await prisma.slotHold.findUniqueOrThrow({ where: { id: hold.body.slotHoldId } });
    expect(slotHold.status).toBe('CONFIRMED');
  });

  test('a duplicate webhook (same event id) is a safe no-op', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(11, 9).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
    const gatewayOrderId = order.body.gatewayOrderId as string;
    const payload = capturedPayload(gatewayOrderId, `pay_${hold.body.id}`);
    const eventId = `evt_dup_${hold.body.id}`;

    const first = await signedWebhookRequest(app, payload, eventId);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: 'ok' });

    const second = await signedWebhookRequest(app, payload, eventId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ status: 'duplicate' });

    const webhookEvents = await prisma.webhookEvent.findMany({
      where: { gateway: 'RAZORPAY', eventId },
    });
    expect(webhookEvents).toHaveLength(1);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('CONFIRMED');
  });

  test('an invalid webhook signature is rejected', async () => {
    const res = await signedWebhookRequest(
      app,
      capturedPayload('order_fake', 'pay_fake'),
      'evt_bad_sig',
      { badSignature: true },
    );
    expect(res.status).toBe(401);
  });

  test('a failed-payment webhook marks the payment FAILED and leaves the booking pending', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(12, 9).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
    const gatewayOrderId = order.body.gatewayOrderId as string;

    const res = await signedWebhookRequest(app, failedPayload(gatewayOrderId), `evt_failed_${hold.body.id}`);
    expect(res.status).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId } });
    expect(payment.status).toBe('FAILED');

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('PENDING_PAYMENT');
  });

  test('a payment confirmed after the hold already expired is refunded to coins, not honored', async () => {
    const { agent: customer, customerId } = await createCustomerFixture(app);
    const startTime = futureStart(13, 9).toISOString();

    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
    const gatewayOrderId = order.body.gatewayOrderId as string;

    const walletBefore = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });

    // Force the hold into the past (simulating the expiry sweep having
    // already run by the time Razorpay's webhook arrives — §9 step 7 /
    // §19's explicitly-designed-for race) and run the real sweep.
    await prisma.slotHold.update({
      where: { id: hold.body.slotHoldId },
      data: { holdExpiresAt: new Date(Date.now() - 60_000) },
    });
    await app.get(ExpiryService).expireSlotHolds();

    const cancelledBooking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(cancelledBooking.status).toBe('CANCELLED');

    const res = await signedWebhookRequest(
      app,
      capturedPayload(gatewayOrderId, `pay_late_${hold.body.id}`),
      `evt_late_${hold.body.id}`,
    );
    expect(res.status).toBe(200);

    // The booking must NOT be resurrected — it stays CANCELLED, exactly
    // as the code comment in PaymentsService.handlePaymentCaptured says.
    const bookingAfter = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(bookingAfter.status).toBe('CANCELLED');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId } });
    expect(payment.status).toBe('SUCCESS'); // Razorpay really did capture the money

    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: hold.body.id } });
    expect(refund.status).toBe('COMPLETED');
    expect(refund.coinAmountCredited.toString()).toBe(cancelledBooking.amount.toString());

    const walletAfter = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
    expect(walletAfter.cachedBalance.sub(walletBefore.cachedBalance).toString()).toBe(
      cancelledBooking.amount.toString(),
    );
  });
});
