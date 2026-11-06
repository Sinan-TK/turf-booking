import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { createTestApp, fakeGateway, type FakeCustomerMessenger } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
} from './setup/fixtures';
import { ExpiryService } from '../src/jobs/expiry.service';
import { PaymentsService } from '../src/payments/payments.service';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';

/**
 * What happens to money and to the slot around the checkout timer and the gateway's webhook:
 * a payment the customer's side reports (PROCESSING, 5-minute lock), a webhook that never arrives, a payment captured after the
 * timer, retries on the same order, and the sweeper racing the payment. The pretend gateway (fakeGateway) holds what Razorpay would say.
 */
describe('Payments around expiry and a missing webhook', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let day = 3; // each test books its own day (all within the advance-booking window), so slots never collide

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

  const messenger = () => app.get<FakeCustomerMessenger>(CUSTOMER_MESSENGER);
  const payments = () => app.get(PaymentsService);

  function webhook(payload: unknown, eventId: string) {
    const rawBody = JSON.stringify(payload);
    const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(rawBody).digest('hex');
    return request(app.getHttpServer())
      .post('/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', eventId)
      .send(rawBody);
  }
  const captured = (orderId: string, paymentId: string, amountMinor: number) => ({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountMinor, status: 'captured', currency: 'INR' } } },
  });
  const failed = (orderId: string) => ({
    event: 'payment.failed',
    payload: { payment: { entity: { order_id: orderId, status: 'failed', error_description: 'Card declined' } } },
  });
  const clientSignature = (orderId: string, paymentId: string) =>
    createHmac('sha256', loadEnv().RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest('hex');

  /** A customer with a held slot and an open Razorpay order. */
  async function checkout(popupOpen = false) {
    const { agent, customerId } = await createCustomerFixture(app);
    await prisma.customerProfile.update({ where: { id: customerId }, data: { phoneVerified: true } });
    const startTime = futureStart(day++, 9).toISOString();
    const hold = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    const order = await agent.post('/payments/create-order').send({ bookingId: hold.body.id });
    expect(order.status).toBe(201);
    // Opening the payment popup makes the booking PROCESSING; this helper's customer closes it again (back to pending, order still open).
    if (!popupOpen) expect((await agent.post('/payments/cancel-attempt').send({ bookingId: hold.body.id })).status).toBe(200);
    return {
      agent,
      customerId,
      startTime,
      bookingId: hold.body.id as string,
      slotHoldId: hold.body.slotHoldId as string,
      orderId: order.body.gatewayOrderId as string,
      amountMinor: Math.round(Number(order.body.amount) * 100),
    };
  }
  const bookingOf = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
  const paymentOf = (orderId: string) => prisma.payment.findUniqueOrThrow({ where: { gatewayOrderId: orderId } });
  const expireHold = async (slotHoldId: string) => {
    await prisma.slotHold.update({ where: { id: slotHoldId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
    await app.get(ExpiryService).expireSlotHolds();
  };

  describe('the customer says they paid, and the webhook never comes', () => {
    test('the booking is confirmed by asking the gateway directly (no webhook needed), and it is recorded as confirmed without the webhook', async () => {
      const c = await checkout();
      const paymentId = fakeGateway.capture(c.orderId, c.amountMinor);

      const res = await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('CONFIRMED');

      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.paymentMethod).toBe('MONEY');
      expect(booking.moneyPaid.toString()).toBe(booking.advanceAmount.gt(0) ? booking.advanceAmount.toString() : booking.amount.toString());
      expect(booking.coinsPaid.toString()).toBe('0');
      const payment = await paymentOf(c.orderId);
      expect(payment.status).toBe('SUCCESS');
      expect(payment.confirmedVia).toBe('CLIENT');
      expect(payment.clientVerifiedAt).not.toBeNull();
      const audit = await prisma.auditLog.findFirst({ where: { entityId: c.bookingId, action: 'PAYMENT_CONFIRMED_WITHOUT_WEBHOOK' } });
      expect(audit).not.toBeNull();

      // The webhook turning up afterwards changes nothing.
      const late = await webhook(captured(c.orderId, paymentId, c.amountMinor), `evt_after_${c.bookingId}`);
      expect(late.status).toBe(200);
      expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
    });

    test('with the gateway not (yet) saying captured, the booking goes to PROCESSING and the slot stays locked for 5 minutes', async () => {
      const c = await checkout();
      const paymentId = `pay_unknown_${c.bookingId.slice(0, 8)}`; // the gateway has no capture for it
      const res = await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PROCESSING');

      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('PROCESSING');
      const minutes = (booking.processingUntil!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(4);
      expect(minutes).toBeLessThanOrEqual(5);
      expect((await paymentOf(c.orderId)).status).toBe('PROCESSING');

      // Nobody else can take the slot meanwhile, and the 10-minute sweeper leaves it alone even when the hold's own time has passed.
      const { agent: other } = await createCustomerFixture(app);
      const clash = await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: c.startTime, durationMinutes: 60 });
      expect(clash.status).toBeGreaterThanOrEqual(400);
      await prisma.slotHold.update({ where: { id: c.slotHoldId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      await app.get(ExpiryService).expireSlotHolds();
      expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');

      // The customer cannot cancel it while the payment is being confirmed.
      const cancel = await c.agent.post(`/me/bookings/${c.bookingId}/cancel`).send({});
      expect(cancel.status).toBeGreaterThanOrEqual(400);
    });

    test('a webhook inside the 5 minutes makes the PROCESSING booking CONFIRMED', async () => {
      const c = await checkout();
      const paymentId = `pay_w_${c.bookingId.slice(0, 8)}`;
      await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');

      const res = await webhook(captured(c.orderId, paymentId, c.amountMinor), `evt_in_window_${c.bookingId}`);
      expect(res.status).toBe(200);
      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.processingUntil).toBeNull();
      expect((await paymentOf(c.orderId)).confirmedVia).toBe('WEBHOOK');
    });

    test('at the end of the 5 minutes with nothing captured the booking FAILS and the slot is released for others', async () => {
      const c = await checkout();
      const paymentId = `pay_none_${c.bookingId.slice(0, 8)}`;
      await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      await prisma.booking.update({ where: { id: c.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });

      const result = await payments().reconcileProcessing();
      expect(result.failed).toBeGreaterThanOrEqual(1);
      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('FAILED');
      expect(booking.cancellationReasonCode).toBe('PAYMENT_NOT_CONFIRMED');
      expect((await paymentOf(c.orderId)).status).toBe('EXPIRED');
      expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: c.slotHoldId } })).status).toBe('EXPIRED');

      const { agent: other } = await createCustomerFixture(app);
      const retake = await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: c.startTime, durationMinutes: 60 });
      expect(retake.status).toBe(201);
    });

    test('a payment the gateway DID capture is never failed by the 5-minute deadline: the last look confirms it', async () => {
      const c = await checkout();
      const paymentId = fakeGateway.add(c.orderId, c.amountMinor, 'created'); // not captured when the customer reported it
      await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');

      // The money lands at the gateway, no webhook arrives, and the window is over.
      fakeGateway.attempts.get(c.orderId)![0]!.status = 'captured';
      await prisma.booking.update({ where: { id: c.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });
      await payments().reconcileProcessing();

      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('CONFIRMED');
      expect((await paymentOf(c.orderId)).confirmedVia).toBe('RECONCILER');
    });

    test('with the gateway unreachable the booking stays PROCESSING (nothing is failed on a guess) until it can be asked again', async () => {
      const c = await checkout();
      const paymentId = `pay_down_${c.bookingId.slice(0, 8)}`;
      fakeGateway.down = true;
      const res = await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PROCESSING');
      expect((await bookingOf(c.bookingId)).status).toBe('PROCESSING');
    });
  });

  describe('verify is safe', () => {
    test('a wrong signature changes nothing', async () => {
      const c = await checkout();
      const res = await c.agent
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'f'.repeat(64) });
      expect(res.status).toBe(400);
      expect((await bookingOf(c.bookingId)).status).toBe('PENDING_PAYMENT');
    });

    test("another customer cannot confirm someone else's payment", async () => {
      const c = await checkout();
      const paymentId = fakeGateway.capture(c.orderId, c.amountMinor);
      const { agent: stranger } = await createCustomerFixture(app);
      const res = await stranger
        .post('/payments/verify')
        .send({ razorpayOrderId: c.orderId, razorpayPaymentId: paymentId, razorpaySignature: clientSignature(c.orderId, paymentId) });
      expect(res.status).toBe(403);
      expect((await bookingOf(c.bookingId)).status).toBe('PENDING_PAYMENT');
    });
  });

  describe('captured after the timer ran out', () => {
    test('the slot is still free: the booking is put back and confirmed (the money is kept, nothing refunded)', async () => {
      const c = await checkout();
      await expireHold(c.slotHoldId);
      expect((await bookingOf(c.bookingId)).status).toBe('CANCELLED');

      const res = await webhook(captured(c.orderId, `pay_late_free_${c.bookingId.slice(0, 8)}`, c.amountMinor), `evt_late_free_${c.bookingId}`);
      expect(res.status).toBe(200);
      const booking = await bookingOf(c.bookingId);
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.cancellationReasonCode).toBeNull();
      expect(booking.moneyPaid.gt(0)).toBe(true);
      expect((await prisma.slotHold.findUniqueOrThrow({ where: { id: c.slotHoldId } })).status).toBe('CONFIRMED');
      expect(await prisma.refund.count({ where: { bookingId: c.bookingId } })).toBe(0);
      expect(messenger().confirmed.some((m) => m.orderId === booking.orderId)).toBe(true);
    });

    test('the slot was taken: everything is refunded as Coins and the customer is told', async () => {
      const c = await checkout();
      await expireHold(c.slotHoldId);
      const { agent: other } = await createCustomerFixture(app);
      expect((await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: c.startTime, durationMinutes: 60 })).status).toBe(201);
      const before = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId: c.customerId } });

      const res = await webhook(captured(c.orderId, `pay_late_taken_${c.bookingId.slice(0, 8)}`, c.amountMinor), `evt_late_taken_${c.bookingId}`);
      expect(res.status).toBe(200);
      expect((await bookingOf(c.bookingId)).status).toBe('CANCELLED');
      const after = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId: c.customerId } });
      expect(Number(after.cachedBalance.sub(before.cachedBalance))).toBe(c.amountMinor / 100);
      const booking = await bookingOf(c.bookingId);
      expect(messenger().lateRefunds.some((m) => m.orderId === booking.orderId && Number(m.coins) === c.amountMinor / 100)).toBe(true);
    });

    test('a booking the customer cancelled is never put back: the money is refunded as Coins', async () => {
      const c = await checkout();
      const cancel = await c.agent.post(`/me/bookings/${c.bookingId}/cancel`).send({});
      expect(cancel.status).toBe(201);
      const res = await webhook(captured(c.orderId, `pay_after_cancel_${c.bookingId.slice(0, 8)}`, c.amountMinor), `evt_after_cancel_${c.bookingId}`);
      expect(res.status).toBe(200);
      expect((await bookingOf(c.bookingId)).status).toBe('CANCELLED');
      expect(await prisma.refund.count({ where: { bookingId: c.bookingId } })).toBe(1);
    });

    test('after a FAILED booking, a capture with the slot free confirms it; with the slot taken it is refunded as Coins', async () => {
      const free = await checkout();
      const pid = `pay_failed_free_${free.bookingId.slice(0, 8)}`;
      await free.agent.post('/payments/verify').send({ razorpayOrderId: free.orderId, razorpayPaymentId: pid, razorpaySignature: clientSignature(free.orderId, pid) });
      await prisma.booking.update({ where: { id: free.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });
      await payments().reconcileProcessing();
      expect((await bookingOf(free.bookingId)).status).toBe('FAILED');
      await webhook(captured(free.orderId, pid, free.amountMinor), `evt_failed_free_${free.bookingId}`);
      expect((await bookingOf(free.bookingId)).status).toBe('CONFIRMED');

      const taken = await checkout();
      const pid2 = `pay_failed_taken_${taken.bookingId.slice(0, 8)}`;
      await taken.agent.post('/payments/verify').send({ razorpayOrderId: taken.orderId, razorpayPaymentId: pid2, razorpaySignature: clientSignature(taken.orderId, pid2) });
      await prisma.booking.update({ where: { id: taken.bookingId }, data: { processingUntil: new Date(Date.now() - 1000) } });
      await payments().reconcileProcessing();
      const { agent: other } = await createCustomerFixture(app);
      expect((await other.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: taken.startTime, durationMinutes: 60 })).status).toBe(201);
      await webhook(captured(taken.orderId, pid2, taken.amountMinor), `evt_failed_taken_${taken.bookingId}`);
      expect((await bookingOf(taken.bookingId)).status).toBe('FAILED');
      expect(await prisma.refund.count({ where: { bookingId: taken.bookingId } })).toBe(1);
    });

    test('a captured amount that is not what was asked for is refunded as Coins, never confirmed', async () => {
      const c = await checkout();
      const res = await webhook(captured(c.orderId, `pay_wrong_${c.bookingId.slice(0, 8)}`, c.amountMinor + 5000), `evt_wrong_${c.bookingId}`);
      expect(res.status).toBe(200);
      expect((await bookingOf(c.bookingId)).status).toBe('CANCELLED');
      const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: c.bookingId } });
      expect(Number(refund.coinAmountCredited)).toBe((c.amountMinor + 5000) / 100);
      expect(await prisma.auditLog.findFirst({ where: { entityId: c.bookingId, action: 'PAYMENT_AMOUNT_MISMATCH' } })).not.toBeNull();
    });
  });

  describe('races and retries', () => {
    test('a payment that failed and is then retried on the same order and captured still confirms the booking', async () => {
      const c = await checkout();
      expect((await webhook(failed(c.orderId), `evt_fail_${c.bookingId}`)).status).toBe(200);
      expect((await paymentOf(c.orderId)).status).toBe('FAILED');
      const res = await webhook(captured(c.orderId, `pay_retry_${c.bookingId.slice(0, 8)}`, c.amountMinor), `evt_retry_${c.bookingId}`);
      expect(res.status).toBe(200);
      expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
      expect((await paymentOf(c.orderId)).status).toBe('SUCCESS');
    });

    test('a webhook event that failed earlier is run again when the gateway re-sends it (it is not treated as a duplicate)', async () => {
      const c = await checkout();
      const eventId = `evt_resend_${c.bookingId}`;
      const payload = captured(c.orderId, `pay_resend_${c.bookingId.slice(0, 8)}`, c.amountMinor);
      await prisma.webhookEvent.create({ data: { gateway: 'RAZORPAY', eventId, eventType: 'payment.captured', payload, signatureValid: true, status: 'FAILED' } });
      const res = await webhook(payload, eventId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
      // Now it is done, a third delivery is a duplicate.
      expect((await webhook(payload, eventId)).body).toEqual({ status: 'duplicate' });
    });

    test('the sweeper winning the race right before the webhook still ends well (late rules, not a lost payment)', async () => {
      const c = await checkout();
      // The sweep cancels the booking; the webhook then arrives for a booking it can no longer confirm.
      await expireHold(c.slotHoldId);
      const res = await webhook(captured(c.orderId, `pay_race_${c.bookingId.slice(0, 8)}`, c.amountMinor), `evt_race_${c.bookingId}`);
      expect(res.status).toBe(200);
      expect((await paymentOf(c.orderId)).status).toBe('SUCCESS'); // never left PENDING with money taken
      const booking = await bookingOf(c.bookingId);
      expect(['CONFIRMED', 'CANCELLED']).toContain(booking.status);
      if (booking.status === 'CANCELLED') expect(await prisma.refund.count({ where: { bookingId: c.bookingId } })).toBe(1);
    });
  });

  describe('starting a payment', () => {
    test('a hold whose time has passed cannot start a payment', async () => {
      const { agent } = await createCustomerFixture(app);
      const hold = await agent.post('/bookings/hold').send({ resourceId: venue.halfAId, startTime: futureStart(day++, 9).toISOString(), durationMinutes: 60 });
      await prisma.slotHold.update({ where: { id: hold.body.slotHoldId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      const res = await agent.post('/payments/create-order').send({ bookingId: hold.body.id });
      expect(res.status).toBe(409);
    });

    test('clicking pay twice reuses the open order instead of making another', async () => {
      const c = await checkout();
      const again = await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
      expect(again.status).toBe(201);
      expect(again.body.gatewayOrderId).toBe(c.orderId);
      expect(await prisma.payment.count({ where: { bookingId: c.bookingId } })).toBe(1);
    });

    test('the hold is never stretched past the maximum, however often payment is started', async () => {
      const c = await checkout();
      // A booking made long ago (older than the maximum hold) cannot have its hold pushed out any further.
      await prisma.booking.update({ where: { id: c.bookingId }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
      await prisma.slotHold.update({ where: { id: c.slotHoldId }, data: { holdExpiresAt: new Date(Date.now() + 60_000) } });
      await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
      const hold = await prisma.slotHold.findUniqueOrThrow({ where: { id: c.slotHoldId } });
      expect(hold.holdExpiresAt.getTime() - Date.now()).toBeLessThan(2 * 60_000);
    });

    test('a booking that is PROCESSING cannot start another payment', async () => {
      const c = await checkout();
      const pid = `pay_proc_${c.bookingId.slice(0, 8)}`;
      await c.agent.post('/payments/verify').send({ razorpayOrderId: c.orderId, razorpayPaymentId: pid, razorpaySignature: clientSignature(c.orderId, pid) });
      const res = await c.agent.post('/payments/create-order').send({ bookingId: c.bookingId });
      expect(res.status).toBe(409);
    });
  });

  describe('the reconciler', () => {
    test('a capture whose webhook never arrived (and the customer left) is found and confirmed', async () => {
      const c = await checkout();
      fakeGateway.capture(c.orderId, c.amountMinor);
      await prisma.payment.update({ where: { gatewayOrderId: c.orderId }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
      const result = await payments().reconcileStale();
      expect(result.settled).toBeGreaterThanOrEqual(1);
      expect((await bookingOf(c.bookingId)).status).toBe('CONFIRMED');
      expect((await paymentOf(c.orderId)).confirmedVia).toBe('RECONCILER');
    });

    test('an abandoned payment older than the maximum hold is closed (EXPIRED) and nothing is confirmed', async () => {
      const c = await checkout();
      await expireHold(c.slotHoldId);
      await prisma.payment.update({ where: { gatewayOrderId: c.orderId }, data: { createdAt: new Date(Date.now() - 60 * 60_000) } });
      await payments().reconcileStale();
      expect((await paymentOf(c.orderId)).status).toBe('EXPIRED');
      expect((await bookingOf(c.bookingId)).status).toBe('CANCELLED');
    });
  });
});
