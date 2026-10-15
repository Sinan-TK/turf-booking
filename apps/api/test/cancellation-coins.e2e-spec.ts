import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
} from './setup/fixtures';

/**
 * Coins (ARCHITECTURE.md §10/§11): money and coins are mutually
 * exclusive per booking by construction (two entirely separate
 * endpoints, never a blended amount), cancellation refunds always land
 * as coins regardless of the original payment method, and the ledger
 * must reflect every credit/debit correctly. Formalizes Phase 7's
 * manual verification.
 */
describe('Cancellation, coin redemption, and payment-method exclusivity', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let adminAgent: Awaited<ReturnType<typeof loginAsSuperAdmin>>;

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);
    venue = await createVenueFixture(app, ownerAgent, adminAgent);
  });

  afterAll(async () => {
    await app.close();
  });

  test('paying with coins confirms the booking and debits the wallet', async () => {
    const { agent: customer, customerId } = await createCustomerFixture(app);

    const adjust = await adminAgent
      .post('/admin/coins/adjust')
      .send({ customerId, signedAmount: 1000, reason: 'E2E test top-up' });
    expect(adjust.status).toBe(201);

    const startTime = futureStart(14, 9).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);
    const bookingAmount = hold.body.amount as string;

    const pay = await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(201);
    expect(pay.body.status).toBe('CONFIRMED');
    expect(pay.body.paymentMethod).toBe('COINS');

    const wallet = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
    expect(wallet.cachedBalance.toString()).toBe((1000 - Number(bookingAmount)).toString());

    const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: hold.body.id } });
    expect(payment.provider).toBe('COINS');
    expect(payment.status).toBe('SUCCESS');
  });

  test('paying with coins fails cleanly when the balance is insufficient', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    // Deliberately no coin top-up — wallet starts at 0.
    const startTime = futureStart(15, 9).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.status).toBe(201);

    const pay = await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(400);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
    expect(booking.status).toBe('PENDING_PAYMENT');
  });

  test('a booking already paid cannot also be paid for with money (mutual exclusivity)', async () => {
    const { agent: customer, customerId } = await createCustomerFixture(app);
    await adminAgent
      .post('/admin/coins/adjust')
      .send({ customerId, signedAmount: 1000, reason: 'E2E test top-up' });

    const startTime = futureStart(16, 9).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    const pay = await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(201);

    // The money half of the exclusivity rule: create-order must reject a
    // booking that's no longer PENDING_PAYMENT — there is no code path
    // that lets a CONFIRMED-via-coins booking also collect a Razorpay
    // charge.
    const orderAttempt = await customer.post('/payments/create-order').send({ bookingId: hold.body.id });
    expect(orderAttempt.status).toBe(400);
  });

  test('cancelling a paid booking creates a coin refund per the cancellation policy', async () => {
    const { agent: customer, customerId } = await createCustomerFixture(app);
    await adminAgent
      .post('/admin/coins/adjust')
      .send({ customerId, signedAmount: 1000, reason: 'E2E test top-up' });

    // Far enough in the future that the platform default policy's
    // longest-lead-time tier (100% refund) applies — avoids this test
    // silently depending on whatever tiers happen to be seeded.
    const startTime = futureStart(20, 9).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    const bookingAmount = hold.body.amount as string;
    const pay = await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect(pay.status).toBe(201);

    const walletBeforeCancel = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });

    const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({ reason: 'e2e test' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.booking.status).toBe('CANCELLED');
    expect(cancel.body.refund).not.toBeNull();
    expect(cancel.body.refund.status).toBe('COMPLETED');

    const walletAfterCancel = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
    const credited = walletAfterCancel.cachedBalance.sub(walletBeforeCancel.cachedBalance);
    expect(credited.toNumber()).toBeGreaterThan(0);
    expect(credited.toNumber()).toBeLessThanOrEqual(Number(bookingAmount));

    // The resource must be free again for someone else at that time.
    const { agent: otherCustomer } = await createCustomerFixture(app);
    const rebook = await otherCustomer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(rebook.status).toBe(201);
  });

  test('cancelling a never-paid booking produces no refund', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    const startTime = futureStart(21, 9).toISOString();
    const hold = await customer
      .post('/bookings/hold')
      .send({ resourceId: venue.halfAId, startTime, durationMinutes: 60 });
    expect(hold.body.status).toBe('PENDING_PAYMENT');

    const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({});
    expect(cancel.status).toBe(201);
    expect(cancel.body.refund).toBeNull();
  });
});
