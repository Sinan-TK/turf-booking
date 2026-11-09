import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
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
import { PayoutsService } from '../src/settlements/payouts.service';

/**
 * Weekly payouts: on the platform's payout day every unpaid settlement of slots before that day is grouped
 * into one payout per organization; a paid payout is closed, later settlements wait for the next one. The
 * day and timezone are platform terms, not constants.
 */
const TERMS = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: null,
  afterCapFeePercent: 0,
  minAdvancePercent: 25,
  cancellationTiers: [{ minHoursBeforeStart: 48, refundPercent: 100, ownerPercent: 0 }],
  cancelCutoffMinutes: 48 * 60,
};

describe('Weekly owner payouts', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let settlements: SettlementsService;
  let payouts: PayoutsService;
  let defaultTerms: Record<string, unknown>;
  let hour = 0;

  async function org() {
    const { ownerAgent, organizationId } = await createOwnerFixture(app, adminAgent);
    const categoryId = await createCategoryFixture(adminAgent, TERMS);
    const venue = await createVenueFixture(app, ownerAgent, adminAgent, { categoryId });
    return { ownerAgent, organizationId, categoryId, ...venue };
  }

  /** A paid booking whose slot (800 online, 80 commission, 720 to the owner) started at `slotStart`. */
  async function playedAt(resourceId: string, slotStart: Date) {
    const { agent, customerId } = await createCustomerFixture(app);
    await adminAgent.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(20 + Math.floor(hour / 12), 8 + (hour % 12)).toISOString(), durationMinutes: 60 });
    hour++;
    expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    await prisma.booking.update({
      where: { id: hold.body.id },
      data: { startTime: slotStart, endTime: new Date(slotStart.getTime() + 3_600_000) },
    });
    return hold.body.id as string;
  }

  /** The most recent payout day (00:00 IST on the platform's payout weekday) before now. */
  async function lastPayoutDay() {
    return (await payouts.payoutSchedule(new Date())).periodEnd;
  }

  const hoursFrom = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    settlements = app.get(SettlementsService);
    payouts = app.get(PayoutsService);
    defaultTerms = (await adminAgent.get('/admin/commercial-terms/default')).body.terms;
  });

  afterEach(async () => {
    // Other specs share this database: put the payout day back.
    const put = await adminAgent.put('/admin/commercial-terms/default').send(defaultTerms);
    expect(put.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  test('slots before the payout day are grouped per organization; later slots wait', async () => {
    const a = await org();
    const b = await org();
    const end = await lastPayoutDay();
    const a1 = await playedAt(a.halfAId, hoursFrom(end, -30));
    const a2 = await playedAt(a.halfBId, hoursFrom(end, -100));
    const b1 = await playedAt(b.halfAId, hoursFrom(end, -50));
    const after = await playedAt(a.fullGroundId, hoursFrom(end, -6) /* ends before now but sits in the open week */);
    await prisma.booking.update({ where: { id: after }, data: { startTime: hoursFrom(end, 2), endTime: hoursFrom(end, 3) } });

    await settlements.completeAndSettle(hoursFrom(end, 10));
    const made = await payouts.createDuePayouts(hoursFrom(end, 10));
    const mine = made.filter((p) => [a.organizationId, b.organizationId].includes(p.organizationId));
    expect(mine).toHaveLength(2);

    const pa = mine.find((p) => p.organizationId === a.organizationId)!;
    const pb = mine.find((p) => p.organizationId === b.organizationId)!;
    expect(pa.settlementCount).toBe(2);
    expect(Number(pa.totalOwnerAmount)).toBe(1440);
    expect(pb.settlementCount).toBe(1);
    expect(Number(pb.totalOwnerAmount)).toBe(720);
    expect(pa.status).toBe('INITIATED');
    expect(pa.periodEnd.getTime()).toBe(end.getTime());

    for (const id of [a1, a2]) expect((await prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId: id } })).payoutId).toBe(pa.id);
    expect((await prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId: b1 } })).payoutId).toBe(pb.id);
    expect((await prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId: after } })).payoutId).toBeNull();
  });

  test('running it again changes nothing; new settlements join the open payout', async () => {
    const a = await org();
    const end = await lastPayoutDay();
    const first = await playedAt(a.halfAId, hoursFrom(end, -40));
    await settlements.completeAndSettle(hoursFrom(end, 10));
    await payouts.createDuePayouts(hoursFrom(end, 10));
    await payouts.createDuePayouts(hoursFrom(end, 10));
    expect(await prisma.payout.count({ where: { organizationId: a.organizationId } })).toBe(1);

    const late = await playedAt(a.halfBId, hoursFrom(end, -20));
    await settlements.completeAndSettle(hoursFrom(end, 12));
    await payouts.createDuePayouts(hoursFrom(end, 12));
    const payout = await prisma.payout.findFirstOrThrow({ where: { organizationId: a.organizationId } });
    expect(payout.settlementCount).toBe(2);
    expect(Number(payout.totalOwnerAmount)).toBe(1440);
    expect((await prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId: late } })).payoutId).toBe(payout.id);
    expect(first).toBeTruthy();
  });

  test('marking a payout paid closes it: the next week gets its own payout', async () => {
    const a = await org();
    const end = await lastPayoutDay();
    await playedAt(a.halfAId, hoursFrom(end, -40));
    await settlements.completeAndSettle(hoursFrom(end, 10));
    const [payout] = (await payouts.createDuePayouts(hoursFrom(end, 10))).filter((p) => p.organizationId === a.organizationId);

    const short = await adminAgent.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'x' });
    expect(short.status).toBe(400);
    const paid = await adminAgent.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'UTR123456789' });
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.reference).toBe('UTR123456789');
    expect((await adminAgent.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'UTR987654321' })).status).toBe(400);

    // A slot of the following week is paid next Monday, in a new payout.
    const nextEnd = DateTime.fromJSDate(end).plus({ weeks: 1 }).toJSDate();
    await playedAt(a.halfBId, hoursFrom(end, 30));
    await settlements.completeAndSettle(hoursFrom(nextEnd, 10));
    const next = (await payouts.createDuePayouts(hoursFrom(nextEnd, 10))).filter((p) => p.organizationId === a.organizationId);
    expect(next).toHaveLength(1);
    expect(next[0]!.id).not.toBe(payout!.id);
    expect(next[0]!.periodEnd.getTime()).toBe(nextEnd.getTime());
    expect(await prisma.payout.count({ where: { organizationId: a.organizationId } })).toBe(2);
  });

  test('the payout day and timezone are platform terms', async () => {
    const now = new Date('2026-11-12T10:00:00Z'); // a Thursday
    const monday = await payouts.payoutSchedule(now);
    expect(DateTime.fromJSDate(monday.periodEnd).setZone('Asia/Kolkata').toFormat('cccc HH:mm')).toBe('Monday 00:00');

    const put = await adminAgent.put('/admin/commercial-terms/default').send({ ...defaultTerms, payoutWeekday: 5 });
    expect(put.status).toBe(200);
    const friday = await payouts.payoutSchedule(now);
    expect(DateTime.fromJSDate(friday.periodEnd).setZone('Asia/Kolkata').toFormat('cccc HH:mm')).toBe('Friday 00:00');
    expect(friday.periodEnd.getTime()).toBeLessThan(now.getTime());
    expect(friday.nextPayoutOn.getTime() - friday.periodEnd.getTime()).toBe(7 * 86_400_000);
  });

  test('owners see only their own payouts and earnings; staff and strangers are refused', async () => {
    const a = await org();
    const b = await org();
    const end = await lastPayoutDay();
    await playedAt(a.halfAId, hoursFrom(end, -40));
    await settlements.completeAndSettle(hoursFrom(end, 10));
    const [payout] = (await payouts.createDuePayouts(hoursFrom(end, 10))).filter((p) => p.organizationId === a.organizationId);

    const list = await a.ownerAgent.get('/owner/payouts');
    expect(list.status).toBe(200);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([payout!.id]);
    expect((await b.ownerAgent.get('/owner/payouts')).body).toEqual([]);

    const detail = await a.ownerAgent.get(`/owner/payouts/${payout!.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.settlements).toHaveLength(1);
    expect(Number(detail.body.settlements[0].commission)).toBe(80);
    expect((await b.ownerAgent.get(`/owner/payouts/${payout!.id}`)).status).toBe(403);
    expect((await a.ownerAgent.get('/admin/payouts')).status).toBe(403);
    expect((await adminAgent.get('/owner/payouts')).status).toBe(403);

    const earnings = await a.ownerAgent.get('/owner/earnings');
    expect(earnings.status).toBe(200);
    expect(earnings.body.facilities.every((f: { venueId: string }) => f.venueId === a.venueId)).toBe(true);
    expect(earnings.body.pendingPayouts.count).toBe(1);
    expect(Number(earnings.body.pendingPayouts.total)).toBe(720);
  });

  test('earnings show the month so far: bookings, commission and the next booking\'s rate', async () => {
    const a = await org();
    const start = DateTime.now().setZone('Asia/Kolkata').startOf('month').plus({ hours: 8 }).toJSDate();
    if (start.getTime() > Date.now() - 4 * 3_600_000) return; // first hours of a month: nothing ended yet
    await playedAt(a.halfAId, start);
    await settlements.completeAndSettle();
    const res = await a.ownerAgent.get('/owner/earnings');
    const row = res.body.facilities.find((f: { categoryId: string }) => f.categoryId === a.categoryId);
    expect(row.bookings).toBe(1);
    expect(row.commission).toBe('80.00');
    expect(row.monthlyCommissionCap).toBeNull();
    expect(row.nextCommission).toMatchObject({ type: 'PERCENTAGE', value: 10 });
    expect(Number(res.body.notYetInPayout.total)).toBeGreaterThanOrEqual(720);
  });

  test('admin: totals and the manual run', async () => {
    const summary = await adminAgent.get('/admin/payouts/summary');
    expect(summary.status).toBe(200);
    for (const key of ['coinsOutstanding', 'platformEarningsThisMonth', 'commissionThisMonth', 'pendingPayouts']) {
      expect(summary.body).toHaveProperty(key);
    }
    const run = await adminAgent.post('/admin/payouts/run').send({});
    expect(run.status).toBe(201);
    expect(run.body).toHaveProperty('payouts');
    const list = await adminAgent.get('/admin/payouts?status=INITIATED&limit=5');
    expect(list.status).toBe(200);
    expect(Number(list.headers['x-total-count'])).toBeGreaterThanOrEqual(list.body.length);
    expect((await adminAgent.get('/admin/payouts?status=BOGUS')).status).toBe(400);
  });
});
