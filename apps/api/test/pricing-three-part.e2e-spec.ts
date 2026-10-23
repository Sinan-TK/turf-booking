import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { DateTime } from 'luxon';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function capturedWebhook(app: INestApplication, gatewayOrderId: string, gatewayPaymentId: string, eventId: string) {
  const body = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: gatewayPaymentId, order_id: gatewayOrderId, status: 'captured', currency: 'INR' } } },
  });
  const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');
  return request(app.getHttpServer())
    .post('/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', signature)
    .set('x-razorpay-event-id', eventId)
    .send(body);
}

/**
 * A price has three parts: normal (the full price), an optional offer below it (then the full price), and the
 * booking price: the advance paid online to hold the slot. The rest is paid at the venue.
 */
describe('Normal, offer and booking prices', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let facilityCode: string;
  let unitId: string; // priced: normal 1000, offer 800, booking 300
  let plainId: string; // priced with the old single `price`
  let categoryId: string;

  const rule = (resourceId: string, body: Record<string, unknown>) =>
    owner.post('/resources/pricing-rules').send({ resourceId, durationMinutes: 60, days: ALL_DAYS, ...body });

  async function newUnit(name: string) {
    const res = await owner
      .post('/resources')
      .send({ venueId: venue.venueId, categoryId, name, groundType: '5S', isBookable: true, sortOrder: 9 })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, owner, admin);
    facilityCode = (await owner.get(`/venues/${venue.venueId}`).expect(200)).body.facilityCode;
    categoryId = (await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'FOOTBALL_TURF' } })).id;
    unitId = await newUnit('Priced three ways');
    plainId = await newUnit('Priced the old way');
  }, 180_000);
  afterAll(async () => app.close());

  it('keeps accepting a single price: it is the normal price, paid in full online', async () => {
    const res = await rule(plainId, { price: 500 }).expect(201);
    expect(Number(res.body.normalPrice)).toBe(500);
    expect(res.body.offerPrice).toBeNull();
    expect(Number(res.body.bookingPrice)).toBe(500);
    expect(res.body.price).toBe(500);
  });

  it('checks the three prices against each other', async () => {
    // (every attempt is on a fresh duration, so the overlap check never gets in the way)
    const bad = async (body: Record<string, unknown>, text: RegExp) => {
      const res = await owner
        .post('/resources/pricing-rules')
        .send({ resourceId: unitId, durationMinutes: 30, days: ALL_DAYS, ...body })
        .expect(400);
      expect(JSON.stringify(res.body)).toMatch(text);
    };
    await bad({ normalPrice: 1000, offerPrice: 1000 }, /offer price must be below the normal/i);
    await bad({ normalPrice: 1000, offerPrice: 1200 }, /offer price must be below the normal/i);
    await bad({ normalPrice: 1000, bookingPrice: 1200 }, /can't be more than the normal price/i);
    await bad({ normalPrice: 1000, offerPrice: 800, bookingPrice: 900 }, /can't be more than the offer price/i);
    await bad({ normalPrice: 1000, bookingPrice: 0 }, /more than 0/i);
    await owner
      .post('/resources/pricing-rules')
      .send({ resourceId: unitId, durationMinutes: 30, days: ALL_DAYS })
      .expect(400); // no price at all
  });

  it('stores normal, offer and booking, and reports the full price', async () => {
    const res = await rule(unitId, { normalPrice: 1000, offerPrice: 800, bookingPrice: 300 }).expect(201);
    expect(Number(res.body.normalPrice)).toBe(1000);
    expect(Number(res.body.offerPrice)).toBe(800);
    expect(Number(res.body.bookingPrice)).toBe(300);
    expect(res.body.price).toBe(800);
    const list = (await owner.get(`/resources/pricing-rules?resourceId=${unitId}`).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0].price).toBe(800);
  });

  it('edits the prices with the same checks, and removes an offer', async () => {
    const [existing] = (await owner.get(`/resources/pricing-rules?resourceId=${unitId}`).expect(200)).body;
    await owner.patch(`/resources/pricing-rules/${existing.id}`).send({ bookingPrice: 900 }).expect(400);
    await owner.patch(`/resources/pricing-rules/${existing.id}`).send({ offerPrice: 1000 }).expect(400);
    // Dropping the offer makes the normal price the full price again; the booking price may stay.
    const noOffer = await owner.patch(`/resources/pricing-rules/${existing.id}`).send({ offerPrice: null }).expect(200);
    expect(noOffer.body.offerPrice).toBeNull();
    expect(noOffer.body.price).toBe(1000);
    // ...and a lower normal price than the booking price is refused.
    await owner.patch(`/resources/pricing-rules/${existing.id}`).send({ normalPrice: 200 }).expect(400);
    await owner.patch(`/resources/pricing-rules/${existing.id}`).send({ offerPrice: 800 }).expect(200);
  });

  it('search shows the full price, the struck-through normal price and the advance', async () => {
    const day = DateTime.fromJSDate(futureStart(5, 9)).setZone('Asia/Kolkata').toFormat('yyyy-MM-dd');
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ facilityCode, date: day, timeWindow: 'ALL', durationMinutes: 60 })
      .expect(200);
    const row = res.body.find((x: { resource: { id: string } }) => x.resource.id === unitId);
    expect(row.price.amount).toBe('800');
    expect(row.price.normalAmount).toBe('1000');
    expect(row.price.bookingAmount).toBe('300');
    expect(row.startPrices[0]).toBe('800');
    expect(row.startBookingPrices[0]).toBe('300');
    expect(row.startNormalPrices[0]).toBe('1000');
  });

  describe('booking and paying', () => {
    it('a hold records the full price and the advance; online payment charges only the advance', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: unitId, startTime: futureStart(21, 9).toISOString(), durationMinutes: 60 })
        .expect(201);
      expect(Number(hold.body.amount)).toBe(800);
      expect(Number(hold.body.advanceAmount)).toBe(300);
      expect(Number(hold.body.paidAmount)).toBe(0);

      const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id }).expect(201);
      expect(Number(order.body.amount)).toBe(300);
      await capturedWebhook(app, order.body.gatewayOrderId, `pay_${hold.body.id}`, `evt_3p_${hold.body.id}`).expect(200);

      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: hold.body.id } });
      expect(booking.status).toBe('CONFIRMED');
      expect(Number(booking.amount)).toBe(800);
      expect(Number(booking.paidAmount)).toBe(300); // 500 remains, due at the venue
      const payment = await prisma.payment.findFirstOrThrow({ where: { bookingId: hold.body.id } });
      expect(Number(payment.amount)).toBe(300);

      // The owner collects the balance at the venue, in parts or all at once.
      await owner.post(`/owner/bookings/${booking.id}/collect`).send({ amount: 600 }).expect(400);
      const part = await owner.post(`/owner/bookings/${booking.id}/collect`).send({ amount: 200 }).expect(201);
      expect(Number(part.body.paidAmount)).toBe(500);
      const rest = await owner.post(`/owner/bookings/${booking.id}/collect`).send({}).expect(201);
      expect(Number(rest.body.paidAmount)).toBe(800);
      await owner.post(`/owner/bookings/${booking.id}/collect`).send({}).expect(400); // nothing left
    });

    it('coins pay the advance too, and a cancellation refunds only what was paid online', async () => {
      const { agent: customer, customerId } = await createCustomerFixture(app);
      await admin.post('/admin/coins/adjust').send({ customerId, signedAmount: 1000, reason: 'E2E three-part' }).expect(201);
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: unitId, startTime: futureStart(14, 9).toISOString(), durationMinutes: 60 })
        .expect(201);
      await customer.post(`/bookings/${hold.body.id}/pay-with-coins`).send({}).expect(201);
      const wallet = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
      expect(wallet.cachedBalance.toNumber()).toBe(700); // 1000 - the 300 advance, not the 800 full price

      const cancel = await customer.post(`/me/bookings/${hold.body.id}/cancel`).send({ reason: 'e2e' }).expect(201);
      expect(Number(cancel.body.refund.originalAmount)).toBe(300);
      const after = await prisma.coinWallet.findUniqueOrThrow({ where: { customerId } });
      expect(after.cachedBalance.toNumber()).toBeLessThanOrEqual(1000);
      expect(after.cachedBalance.toNumber()).toBeGreaterThan(700);
    });

    it('a plain price still charges the whole amount online', async () => {
      const { agent: customer } = await createCustomerFixture(app);
      const hold = await customer
        .post('/bookings/hold')
        .send({ resourceId: plainId, startTime: futureStart(15, 9).toISOString(), durationMinutes: 60 })
        .expect(201);
      const order = await customer.post('/payments/create-order').send({ bookingId: hold.body.id }).expect(201);
      expect(Number(order.body.amount)).toBe(500);
    });
  });

  describe('walk-in bookings', () => {
    const walkIn = (extra: Record<string, unknown>, day: number, hour: number) =>
      owner.post('/owner/bookings').send({
        resourceId: unitId,
        durationMinutes: 60,
        customerWhatsappNumber: '+919200000001',
        startTime: futureStart(day, hour).toISOString(),
        ...extra,
      });

    it('is paid in full by default, at the full (offer) price', async () => {
      const res = await walkIn({}, 40, 9).expect(201);
      expect(Number(res.body.amount)).toBe(800);
      expect(Number(res.body.paidAmount)).toBe(800);
      expect(Number(res.body.advanceAmount)).toBe(0);
    });

    it('can record just an advance, leaving the rest to collect', async () => {
      const res = await walkIn({ amountPaid: 200 }, 41, 9).expect(201);
      expect(Number(res.body.paidAmount)).toBe(200);
      const done = await owner.post(`/owner/bookings/${res.body.id}/collect`).send({}).expect(201);
      expect(Number(done.body.paidAmount)).toBe(800);
      await walkIn({ amountPaid: 900 }, 42, 9).expect(400); // more than the booking amount
    });
  });
});
