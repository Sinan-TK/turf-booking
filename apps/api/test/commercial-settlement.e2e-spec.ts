import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { DateTime } from 'luxon';
import { loadEnv } from '@venue/config';
import { createTestApp } from './setup/test-app';
import {
  createCategoryFixture,
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';
import { SettlementsService } from '../src/settlements/settlements.service';

/**
 * When a booking's slot has ended it is completed and settled: commission by the facility's tier for the n-th
 * booking of the month, limited by the monthly cap, then the after-cap fee — all from the terms snapshotted
 * on the booking. Each venue + facility + month has its own counter. Every number here comes from the
 * facility's terms, chosen small so the cap is reached within a few bookings.
 */
const BASE_TERMS = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: 250,
  capPerUnit: false, // the older tests count one shared cap; the per-unit tests turn it on

  afterCapFeePercent: 2.5,
  minAdvancePercent: 25,
  cancellationTiers: [
    { minHoursBeforeStart: 240, refundPercent: 100, ownerPercent: 0 },
    { minHoursBeforeStart: 48, refundPercent: 30, ownerPercent: 50 },
  ],
  cancelCutoffMinutes: 48 * 60,
};

/** Hours of the previous month in IST: always in the past and always in one month, whenever the test runs. */
function lastMonthHour(i: number) {
  return DateTime.now().setZone('Asia/Kolkata').startOf('month').minus({ days: 10 }).plus({ hours: i }).toJSDate();
}

describe('Settling played bookings: tiers, monthly cap and after-cap fee', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let settlements: SettlementsService;
  let slot = 0;

  /** A booking paid online (coins, or money through the signed webhook), then moved to an ended slot. */
  async function playedBooking(resourceId: string, opts: { money?: boolean; hourIndex?: number } = {}) {
    const { agent, customerId } = await createCustomerFixture(app);
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(20 + Math.floor(slot / 12), 8 + (slot % 12)).toISOString(), durationMinutes: 60 });
    slot++;
    expect(hold.status).toBe(201);
    if (opts.money) {
      const order = await agent.post('/payments/create-order').send({ bookingId: hold.body.id });
      expect(order.status).toBe(201);
      const body = JSON.stringify({
        event: 'payment.captured',
        payload: { payment: { entity: { id: `pay_${hold.body.id}`, order_id: order.body.gatewayOrderId, status: 'captured' } } },
      });
      const signature = createHmac('sha256', loadEnv().RAZORPAY_WEBHOOK_SECRET!).update(body).digest('hex');
      const hook = await request(app.getHttpServer())
        .post('/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .set('x-razorpay-event-id', `evt_${hold.body.id}`)
        .send(body);
      expect(hook.status).toBe(200);
    } else {
      await adminAgent.post('/admin/coins/adjust').send({ customerId, signedAmount: 5000, reason: 'E2E top-up' });
      expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    }
    const start = lastMonthHour(opts.hourIndex ?? slot);
    await prisma.booking.update({
      where: { id: hold.body.id },
      data: { startTime: start, endTime: new Date(start.getTime() + 3_600_000) },
    });
    return hold.body.id as string;
  }

  async function facilityVenue(terms: Record<string, unknown>) {
    const categoryId = await createCategoryFixture(adminAgent, terms);
    const venue = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId });
    return { categoryId, ...venue };
  }

  const settlementOf = (bookingId: string) => prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId } });

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    settlements = app.get(SettlementsService);
  });

  afterAll(async () => {
    await app.close();
  });

  test('commission until the cap, a partial booking, then only the after-cap fee', async () => {
    const v = await facilityVenue(BASE_TERMS);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await playedBooking(v.halfAId, { hourIndex: i }));
    await settlements.completeAndSettle();

    const rows = await Promise.all(ids.map(settlementOf));
    // 10% of 800 = 80 each; the cap (250) leaves 10 for the 4th; the 5th pays 2.5% of 800 = 20.
    expect(rows.map((r) => Number(r.commission))).toEqual([80, 80, 80, 10, 0]);
    expect(rows.map((r) => Number(r.fee))).toEqual([0, 0, 0, 0, 20]);
    expect(rows.map((r) => Number(r.ownerAmount))).toEqual([720, 720, 720, 790, 780]);
    expect(rows.every((r) => r.kind === 'PLAYED' && Number(r.collected) === 800)).toBe(true);
    expect(rows.map((r) => (r.details as { bookingNumber: number }).bookingNumber)).toEqual([1, 2, 3, 4, 5]);

    const counter = await prisma.venueCommissionMonth.findFirstOrThrow({ where: { venueId: v.venueId, categoryId: v.categoryId } });
    expect(counter.bookingCount).toBe(5);
    expect(Number(counter.commissionTotal)).toBe(250);
    const statuses = await prisma.booking.findMany({ where: { id: { in: ids } }, select: { status: true } });
    expect(statuses.every((b) => b.status === 'COMPLETED')).toBe(true);
  });

  test('settling again changes nothing', async () => {
    const v = await facilityVenue(BASE_TERMS);
    const id = await playedBooking(v.halfAId);
    await settlements.completeAndSettle();
    const first = await settlementOf(id);
    await settlements.completeAndSettle();
    await settlements.completeAndSettle();
    expect(await prisma.bookingSettlement.count({ where: { bookingId: id } })).toBe(1);
    expect((await settlementOf(id)).id).toBe(first.id);
    const counter = await prisma.venueCommissionMonth.findFirstOrThrow({ where: { venueId: v.venueId } });
    expect(counter.bookingCount).toBe(1);
  });

  test('a money-paid booking settles exactly like a coin-paid one', async () => {
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: null });
    const coin = await playedBooking(v.halfAId, { hourIndex: 0 });
    const money = await playedBooking(v.halfBId, { money: true, hourIndex: 1 });
    await settlements.completeAndSettle();
    const [c, m] = await Promise.all([settlementOf(coin), settlementOf(money)]);
    expect(Number(m.collected)).toBe(800);
    expect(Number(m.commission)).toBe(Number(c.commission));
    expect(Number(m.ownerAmount)).toBe(Number(c.ownerAmount));
  });

  test('commission tiers, flat commissions and no cap all come from the terms', async () => {
    const tiered = await facilityVenue({
      ...BASE_TERMS,
      monthlyCommissionCap: null,
      commissionTiers: [
        { fromBooking: 1, type: 'PERCENTAGE', value: 20 },
        { fromBooking: 3, type: 'PERCENTAGE', value: 5 },
      ],
    });
    const t = [];
    for (let i = 0; i < 4; i++) t.push(await playedBooking(tiered.halfAId, { hourIndex: i }));
    const flat = await facilityVenue({
      ...BASE_TERMS,
      monthlyCommissionCap: null,
      commissionTiers: [{ fromBooking: 1, type: 'FLAT', value: 55 }],
    });
    const f = await playedBooking(flat.halfAId);
    await settlements.completeAndSettle();

    const tieredRows = await Promise.all(t.map(settlementOf));
    expect(tieredRows.map((r) => Number(r.commission))).toEqual([160, 160, 40, 40]);
    expect(tieredRows.every((r) => Number(r.fee) === 0)).toBe(true);
    expect(Number((await settlementOf(f)).commission)).toBe(55);
  });

  test('two facilities in one venue have separate terms and separate caps', async () => {
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: 80 });
    const otherCategory = await createCategoryFixture(adminAgent, { ...BASE_TERMS, monthlyCommissionCap: null, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 15 }] });
    const unit = await ownerAgent
      .post('/resources')
      .send({ venueId: v.venueId, categoryId: otherCategory, name: 'Pool table', groundType: '', isBookable: true, sortOrder: 5 });
    expect(unit.status).toBe(201);
    const rule = await ownerAgent
      .post('/resources/pricing-rules')
      .send({ resourceId: unit.body.id, durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], normalPrice: 800, currency: 'INR' });
    expect(rule.status).toBe(201);

    const a1 = await playedBooking(v.halfAId, { hourIndex: 0 });
    const a2 = await playedBooking(v.halfAId, { hourIndex: 1 });
    const b1 = await playedBooking(unit.body.id, { hourIndex: 2 });
    const b2 = await playedBooking(unit.body.id, { hourIndex: 3 });
    await settlements.completeAndSettle();

    expect(Number((await settlementOf(a1)).commission)).toBe(80);
    expect(Number((await settlementOf(a2)).commission)).toBe(0); // first facility's cap reached
    expect(Number((await settlementOf(b1)).commission)).toBe(120); // other facility: 15%, no cap
    expect(Number((await settlementOf(b2)).commission)).toBe(120);
    expect((await settlementOf(b1)).categoryId).toBe(otherCategory);
  });

  test('the cap is multiplied by the venue units in the facility when capPerUnit is on', async () => {
    // The fixture venue has three units in the facility (two halves and the full ground): 80 x 3 = 240 of commission in the month.
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: 80, capPerUnit: true });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await playedBooking(i % 2 ? v.halfBId : v.halfAId, { hourIndex: i }));
    await settlements.completeAndSettle();
    const rows = await Promise.all(ids.map(settlementOf));
    expect(rows.map((r) => Number(r.commission))).toEqual([80, 80, 80, 0]);
    expect((rows[3]!.details as { unitCount: number }).unitCount).toBe(3);
    expect((rows[3]!.details as { effectiveCap: number }).effectiveCap).toBe(240);
  });

  test('a venue deal overrides the facility for that venue only', async () => {
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: null });
    const deal = await adminAgent
      .put(`/admin/venues/${v.venueId}/facilities/${v.categoryId}/commercial-terms`)
      .send({ commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 0 }] });
    expect(deal.status).toBe(200);
    const id = await playedBooking(v.halfAId);
    await settlements.completeAndSettle();
    expect(Number((await settlementOf(id)).commission)).toBe(0);
    expect(Number((await settlementOf(id)).ownerAmount)).toBe(800);
  });

  test('late cancellations do not count toward the cap or tiers', async () => {
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: null });
    // A late cancellation (5 days out) is settled at cancel time...
    const { agent, customerId } = await createCustomerFixture(app);
    await adminAgent.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId: v.halfBId, startTime: futureStart(5, 9).toISOString(), durationMinutes: 60 });
    await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({});
    expect((await agent.post(`/me/bookings/${hold.body.id}/cancel`).send({})).status).toBe(201);
    expect((await settlementOf(hold.body.id)).kind).toBe('LATE_CANCEL');

    // ...and the first played booking is still booking number 1 of the month.
    const played = await playedBooking(v.halfAId);
    await settlements.completeAndSettle();
    expect(((await settlementOf(played)).details as { bookingNumber: number }).bookingNumber).toBe(1);
  });

  test('walk-ins and bookings from before commercial terms complete without a settlement', async () => {
    const v = await facilityVenue(BASE_TERMS);
    const walkIn = await ownerAgent.post('/owner/bookings').send({
      resourceId: v.halfAId,
      startTime: lastMonthHour(3).toISOString(),
      amount: 500,
      durationMinutes: 60,
      customerWhatsappNumber: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    });
    if (walkIn.status !== 201) throw new Error(JSON.stringify(walkIn.body));
    const legacy = await playedBooking(v.halfBId);
    await prisma.$executeRaw`UPDATE bookings SET "commercialTerms" = NULL WHERE id = ${legacy}::uuid`;
    await settlements.completeAndSettle();

    for (const id of [walkIn.body.id, legacy]) {
      expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe('COMPLETED');
      expect(await prisma.bookingSettlement.findUnique({ where: { bookingId: id } })).toBeNull();
    }
  });

  test('a booking settles on the terms it was made under, not the current ones', async () => {
    const v = await facilityVenue({ ...BASE_TERMS, monthlyCommissionCap: null });
    const id = await playedBooking(v.halfAId);
    const own = (await adminAgent.get(`/admin/categories/${v.categoryId}/commercial-terms`)).body.own;
    await adminAgent
      .put(`/admin/categories/${v.categoryId}/commercial-terms`)
      .send({ ...own, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 25 }] });
    await settlements.completeAndSettle();
    expect(Number((await settlementOf(id)).commission)).toBe(80);
  });
});
