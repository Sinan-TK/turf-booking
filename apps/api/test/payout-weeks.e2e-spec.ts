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
import { SettlementsService, periodMonthOf, nextMonthStart } from '../src/settlements/settlements.service';
import { PayoutsService } from '../src/settlements/payouts.service';
import { settlePlayedBooking } from '@venue/shared';

/**
 * The payout calendar and the monthly cap, checked against fixed dates (so the result never depends on when the test runs).
 *
 *  - A payout covers every settled slot that STARTED before the payout day's 00:00 (platform timezone, Monday in Kolkata by
 *    default), one payout per organisation per week; a paid payout is closed and later arrivals wait for the next week.
 *  - A booking's month, for the commission cap and the commission tier, is the calendar month of its slot's start in the
 *    VENUE's own timezone, whatever week it is paid in.
 */
const IST = 'Asia/Kolkata';
const ist = (iso: string) => DateTime.fromISO(iso, { zone: IST }).toJSDate();

const TERMS = {
  commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }],
  monthlyCommissionCap: null as number | null,
  afterCapFeePercent: 0,
  minAdvancePercent: 25,
  cancellationTiers: [
    { minHoursBeforeStart: 240, refundPercent: 100, ownerPercent: 0 },
    { minHoursBeforeStart: 48, refundPercent: 30, ownerPercent: 50 },
  ],
  cancelCutoffMinutes: 48 * 60,
};

describe('Payout weeks and the monthly cap', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let settlements: SettlementsService;
  let payouts: PayoutsService;
  let defaultTerms: Record<string, unknown>;
  let hour = 0;

  async function org(terms: Record<string, unknown> = TERMS) {
    const { ownerAgent, organizationId } = await createOwnerFixture(app, admin);
    const categoryId = await createCategoryFixture(admin, terms);
    const venue = await createVenueFixture(app, ownerAgent, admin, { categoryId });
    return { ownerAgent, organizationId, categoryId, ...venue };
  }

  /** A booking paid in full online (800: 80 commission and 720 to the owner at 10%), whose slot started at `start`. */
  async function playedAt(resourceId: string, start: Date, durationMs = 3_600_000) {
    const { agent, customerId } = await createCustomerFixture(app);
    await admin.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const hold = await agent
      .post('/bookings/hold')
      .send({ resourceId, startTime: futureStart(20 + Math.floor(hour / 12), 8 + (hour % 12)).toISOString(), durationMinutes: 60 });
    hour++;
    expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    await prisma.booking.update({ where: { id: hold.body.id }, data: { startTime: start, endTime: new Date(start.getTime() + durationMs) } });
    return hold.body.id as string;
  }

  const settlementOf = (bookingId: string) => prisma.bookingSettlement.findUniqueOrThrow({ where: { bookingId } });
  const mine = <T extends { organizationId: string }>(rows: T[], id: string) => rows.filter((r) => r.organizationId === id);
  const putDefault = (patch: Record<string, unknown>) => admin.put('/admin/commercial-terms/default').send({ ...defaultTerms, ...patch }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    settlements = app.get(SettlementsService);
    payouts = app.get(PayoutsService);
    defaultTerms = (await admin.get('/admin/commercial-terms/default')).body.terms;
  });

  afterEach(async () => {
    await admin.put('/admin/commercial-terms/default').send(defaultTerms).expect(200); // the payout day is shared by every spec
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------------------------------------------------
  // The calendar
  // -------------------------------------------------------------------------------------------------------------------

  test('the payout day starts at 00:00 Kolkata time: a second earlier is still last week', async () => {
    const monday = ist('2026-10-26T00:00:00');
    const at = async (iso: string) => (await payouts.payoutSchedule(ist(iso))).periodEnd.getTime();

    expect(await at('2026-10-26T00:00:00')).toBe(monday.getTime()); // exactly Monday 00:00 already pays this Monday
    expect(await at('2026-10-25T23:59:59')).toBe(ist('2026-10-19T00:00:00').getTime()); // Sunday night: still last Monday's
    expect(await at('2026-10-28T15:00:00')).toBe(monday.getTime()); // mid-week
    expect(await at('2026-11-01T23:59:59')).toBe(monday.getTime()); // the whole week shares one payout day
    expect((await payouts.payoutSchedule(ist('2026-10-28T15:00:00'))).nextPayoutOn.getTime()).toBe(ist('2026-11-02T00:00:00').getTime());

    // The same instants written in UTC: Monday 00:00 in Kolkata is Sunday 18:30 UTC.
    expect((await payouts.payoutSchedule(new Date('2026-10-25T18:29:59Z'))).periodEnd.toISOString()).toBe('2026-10-18T18:30:00.000Z');
    expect((await payouts.payoutSchedule(new Date('2026-10-25T18:30:00Z'))).periodEnd.toISOString()).toBe('2026-10-25T18:30:00.000Z');
  });

  test('the payout day and the timezone can be changed, and daylight saving never shifts a payout day off midnight', async () => {
    await putDefault({ payoutWeekday: 5 }); // Friday
    const friday = await payouts.payoutSchedule(ist('2026-10-28T15:00:00'));
    expect(DateTime.fromJSDate(friday.periodEnd).setZone(IST).toFormat('cccc HH:mm yyyy-MM-dd')).toBe('Friday 00:00 2026-10-23');

    await putDefault({ payoutWeekday: 1, payoutTimezone: 'America/New_York' });
    // Monday 26 Oct 00:00 is still summer time (UTC-4); clocks go back on 1 Nov, so Monday 2 Nov 00:00 is UTC-5.
    const summer = await payouts.payoutSchedule(new Date('2026-10-28T12:00:00Z'));
    expect(summer.periodEnd.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    const afterChange = await payouts.payoutSchedule(new Date('2026-11-03T12:00:00Z'));
    expect(afterChange.periodEnd.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // The week that contains the change is 7 days and an hour long in clock time, and still ends at Monday 00:00 local.
    expect(DateTime.fromJSDate(afterChange.periodEnd).setZone('America/New_York').toFormat('cccc HH:mm')).toBe('Monday 00:00');
    expect(afterChange.nextPayoutOn.toISOString()).toBe('2026-11-09T05:00:00.000Z');
    const justBefore = await payouts.payoutSchedule(new Date('2026-11-02T04:59:59Z')); // 23:59:59 Sunday in New York
    expect(justBefore.periodEnd.toISOString()).toBe('2026-10-26T04:00:00.000Z');
  });

  test('an organization can have its own payout day; its payout is created automatically as INITIATED when that day comes', async () => {
    const standard = await org(); // follows the platform default (Monday)
    const own = await org(); // paid on Thursdays
    await admin.patch(`/admin/organizations/${own.organizationId}/payout-day`).send({ payoutWeekday: 4 }).expect(200);
    expect((await prisma.ownerOrganization.findUniqueOrThrow({ where: { id: own.organizationId } })).payoutWeekday).toBe(4);

    // Played on Friday 9 Oct: Monday 12 Oct's payout covers it, Thursday 8 Oct's does not.
    for (const o of [standard, own]) await playedAt(o.halfAId, ist('2026-10-09T09:00:00'));
    const tue = ist('2026-10-13T12:00:00');
    await settlements.completeAndSettle(tue);
    const first = await payouts.createDuePayouts(tue);
    expect(mine(first, standard.organizationId)).toHaveLength(1);
    expect(mine(first, standard.organizationId)[0]!.status).toBe('INITIATED');
    expect(mine(first, own.organizationId)).toHaveLength(0);

    // Thursday 15 Oct 00:00: now it is that organization's day, and the payout appears by itself.
    const thu = ist('2026-10-15T00:00:00');
    const second = await payouts.createDuePayouts(thu);
    const mineNow = mine(second, own.organizationId);
    expect(mineNow).toHaveLength(1);
    expect(mineNow[0]!.status).toBe('INITIATED');
    expect(mineNow[0]!.periodEnd.getTime()).toBe(thu.getTime());
    expect(Number(mineNow[0]!.totalOwnerAmount)).toBe(720);

    // Clearing the day goes back to the platform default.
    await admin.patch(`/admin/organizations/${own.organizationId}/payout-day`).send({ payoutWeekday: null }).expect(200);
    expect((await prisma.ownerOrganization.findUniqueOrThrow({ where: { id: own.organizationId } })).payoutWeekday).toBeNull();
    await admin.patch(`/admin/organizations/${own.organizationId}/payout-day`).send({ payoutWeekday: 9 }).expect(400);
  });

  test('an Initiated payout unpaid for the platform overdue days shows as overdue to the admin only', async () => {
    const o = await org();
    await playedAt(o.halfAId, ist('2026-10-09T09:00:00'));
    const tue = ist('2026-10-13T12:00:00');
    await settlements.completeAndSettle(tue);
    const [payout] = mine(await payouts.createDuePayouts(tue), o.organizationId);
    expect(payout!.status).toBe('INITIATED');

    // Just created: not overdue. Make it 6 days old: overdue at the default 5 days, not at 7.
    const detail = async () => (await admin.get(`/admin/payouts/${payout!.id}`)).body;
    expect((await detail()).overdue).toBe(false);
    await prisma.payout.update({ where: { id: payout!.id }, data: { createdAt: new Date(Date.now() - 6 * 86_400_000) } });
    expect((await detail()).overdue).toBe(true);
    const list = await admin.get(`/admin/payouts?status=OVERDUE&organizationId=${o.organizationId}`);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([payout!.id]);
    expect(list.body[0].overdue).toBe(true);
    expect((await admin.get('/admin/payouts/summary')).body.overduePayouts.count).toBeGreaterThan(0);

    await putDefault({ payoutOverdueDays: 7 });
    expect((await detail()).overdue).toBe(false);
    expect((await admin.get(`/admin/payouts?status=OVERDUE&organizationId=${o.organizationId}`)).body).toHaveLength(0);
    await admin.put('/admin/commercial-terms/default').send({ ...defaultTerms, payoutOverdueDays: 0 }).expect(400);

    // The owner's own view never carries the flag, and a paid payout is never overdue.
    expect(Object.keys(await payouts.getForOwner(payout!.id, o.organizationId))).not.toContain('overdue');
    await admin.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'UTR-OVERDUE-1' }).expect(201);
    expect((await detail()).overdue).toBe(false);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // Week by week
  // -------------------------------------------------------------------------------------------------------------------

  test('three weeks replayed hour by hour: every booking is paid exactly once, in the week its slot started', async () => {
    const a = await org(); // stays pending until the end
    const b = await org(); // pays its week-2 payout before a late settlement arrives

    // Weeks run Monday to Sunday (Kolkata). Payout days: Mon 12 Oct, Mon 19 Oct, Mon 26 Oct.
    const slots = {
      weekAMon: ist('2026-10-05T09:00:00'),
      weekASunLate: ist('2026-10-11T23:00:00'), // ends exactly at the payout day's midnight
      weekBMonStart: ist('2026-10-12T00:00:00'), // starts exactly at the payout day: belongs to week B, not A
      weekBWed: ist('2026-10-14T18:00:00'),
      weekBSunLate: ist('2026-10-18T23:30:00'), // starts before Monday, ends at 00:30 on Monday
    };
    const ids: Record<'a' | 'b', Record<keyof typeof slots, string>> = { a: {} as never, b: {} as never };
    for (const [who, o] of [['a', a], ['b', b]] as const) {
      for (const key of Object.keys(slots) as Array<keyof typeof slots>) ids[who][key] = await playedAt(o.halfAId, slots[key]);
    }

    // Monday 12 Oct 00:00:00 — the first payout day. Week A (everything before it) is prepared; the booking that starts at 00:00 is not.
    const m1 = ist('2026-10-12T00:00:00');
    await settlements.completeAndSettle(m1);
    const week1 = await payouts.createDuePayouts(m1); // one run prepares every organisation's payout
    for (const o of [a, b]) {
      const p = mine(week1, o.organizationId);
      expect(p).toHaveLength(1);
      expect(p[0]!.periodEnd.getTime()).toBe(m1.getTime());
      expect(p[0]!.settlementCount).toBe(2);
      expect(Number(p[0]!.totalOwnerAmount)).toBe(1440);
    }
    for (const who of ['a', 'b'] as const) {
      expect((await settlementOf(ids[who].weekASunLate)).payoutId).not.toBeNull();
      expect(await prisma.bookingSettlement.findUnique({ where: { bookingId: ids[who].weekBMonStart } })).toBeNull(); // not played yet
    }

    // Monday midday: the 00:00 booking has now been played and settled, but it belongs to the next payout.
    const noon = ist('2026-10-12T12:00:00');
    await settlements.completeAndSettle(noon);
    await payouts.createDuePayouts(noon);
    for (const who of ['a', 'b'] as const) expect((await settlementOf(ids[who].weekBMonStart)).payoutId).toBeNull();
    expect(await prisma.payout.count({ where: { organizationId: a.organizationId } })).toBe(1);

    // Monday 19 Oct 00:10 — the next payout day. The Sunday-night slot is still being played (it ends at 00:30).
    const m2 = ist('2026-10-19T00:10:00');
    await settlements.completeAndSettle(m2);
    const week2 = await payouts.createDuePayouts(m2);
    const a2 = mine(week2, a.organizationId)[0]!;
    const b2 = mine(week2, b.organizationId)[0]!;
    expect(a2.periodEnd.getTime()).toBe(ist('2026-10-19T00:00:00').getTime());
    expect(a2.settlementCount).toBe(2); // Monday 00:00 and Wednesday
    expect(Number(a2.totalOwnerAmount)).toBe(1440);

    // The treasurer pays organisation B's payout before the Sunday-night slot has been settled.
    await admin.post(`/admin/payouts/${b2.id}/mark-paid`).send({ reference: 'UTR-WEEK-B-0001' }).expect(201);

    // 01:00 — the hourly run. The Sunday-night slot ended at 00:30 and started before Monday, so it is week B's.
    const m2b = ist('2026-10-19T01:00:00');
    await settlements.completeAndSettle(m2b);
    await payouts.createDuePayouts(m2b);
    const a2after = await prisma.payout.findUniqueOrThrow({ where: { id: a2.id } });
    expect(a2after.settlementCount).toBe(3); // A: still pending, so it joined the open payout
    expect(Number(a2after.totalOwnerAmount)).toBe(2160);
    expect((await settlementOf(ids.a.weekBSunLate)).payoutId).toBe(a2.id);
    const b2after = await prisma.payout.findUniqueOrThrow({ where: { id: b2.id } });
    expect(b2after.settlementCount).toBe(2); // B: already paid and closed, so it did not change
    expect(Number(b2after.totalOwnerAmount)).toBe(1440);
    expect((await settlementOf(ids.b.weekBSunLate)).payoutId).toBeNull(); // waits

    // Monday 26 Oct: B's waiting booking is paid with the next payout. Nothing is paid twice, nothing is lost.
    const m3 = ist('2026-10-26T00:00:00');
    await settlements.completeAndSettle(m3);
    const week3 = await payouts.createDuePayouts(m3);
    const b3 = mine(week3, b.organizationId);
    expect(b3).toHaveLength(1);
    expect(b3[0]!.periodEnd.getTime()).toBe(m3.getTime());
    expect(b3[0]!.settlementCount).toBe(1);
    expect(Number(b3[0]!.totalOwnerAmount)).toBe(720);
    expect(mine(week3, a.organizationId)).toHaveLength(0); // A has nothing new this week, and its week-2 payout stays open
    expect(await prisma.payout.count({ where: { organizationId: a.organizationId } })).toBe(2);
    expect(await prisma.payout.count({ where: { organizationId: b.organizationId } })).toBe(3);

    // Every settlement of both organisations sits in exactly one payout, and the payouts add up to what is owed.
    for (const o of [a, b]) {
      const rows = await prisma.bookingSettlement.findMany({ where: { organizationId: o.organizationId } });
      expect(rows).toHaveLength(5);
      expect(rows.every((r) => r.payoutId !== null)).toBe(true);
      const owed = rows.reduce((s, r) => s + Number(r.ownerAmount), 0);
      const paidOut = (await prisma.payout.findMany({ where: { organizationId: o.organizationId } })).reduce((s, p) => s + Number(p.totalOwnerAmount), 0);
      expect(paidOut).toBe(owed);
      expect(owed).toBe(5 * 720);
    }
  });

  test('a pending payout can grow after it was first prepared: what the treasurer saw is not what is paid', async () => {
    // Recorded here as a known behaviour (see the report): late settlements join an unpaid payout of the same week.
    const o = await org();
    const m = ist('2026-10-12T00:00:00');
    await playedAt(o.halfAId, ist('2026-10-08T10:00:00'));
    await settlements.completeAndSettle(m);
    const [first] = mine(await payouts.createDuePayouts(m), o.organizationId);
    const seenByTreasurer = Number(first!.totalOwnerAmount);

    await playedAt(o.halfBId, ist('2026-10-09T10:00:00'));
    await settlements.completeAndSettle(ist('2026-10-12T05:00:00'));
    await payouts.createDuePayouts(ist('2026-10-12T05:00:00'));
    const grown = await prisma.payout.findUniqueOrThrow({ where: { id: first!.id } });
    expect(Number(grown.totalOwnerAmount)).toBeGreaterThan(seenByTreasurer);

    // Paying with the amount that was reviewed is refused once the payout has changed.
    const stale = await admin.post(`/admin/payouts/${first!.id}/mark-paid`).send({ reference: 'UTR-STALE-0001', totalOwnerAmount: seenByTreasurer.toFixed(2) });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toMatch(/changed/);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: first!.id } })).status).toBe('INITIATED');
    const fresh = await admin.post(`/admin/payouts/${first!.id}/mark-paid`).send({ reference: 'UTR-FRESH-0001', totalOwnerAmount: Number(grown.totalOwnerAmount).toFixed(2) });
    expect(fresh.status).toBe(201);
  });

  test('two admins marking the same payout paid at once: one succeeds, the other is told it is already paid', async () => {
    const o = await org();
    const m = ist('2026-10-12T00:00:00');
    await playedAt(o.halfAId, ist('2026-10-08T10:00:00'));
    await settlements.completeAndSettle(m);
    const [payout] = mine(await payouts.createDuePayouts(m), o.organizationId);
    const results = await Promise.all([
      admin.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'UTR-RACE-000001' }),
      admin.post(`/admin/payouts/${payout!.id}/mark-paid`).send({ reference: 'UTR-RACE-000002' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)!.body.message).toMatch(/already/);
    const stored = await prisma.payout.findUniqueOrThrow({ where: { id: payout!.id } });
    expect(stored.status).toBe('PAID');
    expect(['UTR-RACE-000001', 'UTR-RACE-000002']).toContain(stored.reference);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // The month in the cap
  // -------------------------------------------------------------------------------------------------------------------

  test('the month is the calendar month of the slot in the venue timezone: the cap starts over at local midnight on the 1st', async () => {
    const o = await org({ ...TERMS, monthlyCommissionCap: 100, capPerUnit: false }); // 10% of 800 = 80 a booking: the second one is cut to 20
    // 28 Sep to 4 Oct is one payout week; the month changes in the middle of it, at midnight on 1 Oct in Kolkata.
    const slots = [
      ist('2026-09-30T21:00:00'),
      ist('2026-09-30T23:00:00'), // 23:00 – 24:00
      ist('2026-10-01T00:00:00'), // the first minute of October
      ist('2026-10-01T01:00:00'),
    ];
    const ids: string[] = [];
    for (const s of slots) ids.push(await playedAt(o.halfAId, s));
    await settlements.completeAndSettle(ist('2026-10-05T00:30:00'));
    const rows = await Promise.all(ids.map(settlementOf));

    expect(rows.map((r) => r.periodMonth)).toEqual(['2026-09', '2026-09', '2026-10', '2026-10']);
    expect(rows.map((r) => Number(r.commission))).toEqual([80, 20, 80, 20]); // the cap (100) reached in September, then again in October
    expect(rows.map((r) => (r.details as { bookingNumber: number }).bookingNumber)).toEqual([1, 2, 1, 2]);
    expect(rows.map((r) => Number(r.ownerAmount))).toEqual([720, 780, 720, 780]);
    const counters = await prisma.venueCommissionMonth.findMany({ where: { venueId: o.venueId, categoryId: o.categoryId }, orderBy: { periodMonth: 'asc' } });
    expect(counters.map((c) => [c.periodMonth, c.bookingCount, Number(c.commissionTotal)])).toEqual([['2026-09', 2, 100], ['2026-10', 2, 100]]);

    // Both months were paid in the same weekly payout, because a payout follows the week, not the month.
    const made = mine(await payouts.createDuePayouts(ist('2026-10-05T00:30:00')), o.organizationId);
    expect(made).toHaveLength(1);
    expect(made[0]!.periodEnd.getTime()).toBe(ist('2026-10-05T00:00:00').getTime());
    expect(made[0]!.settlementCount).toBe(4);
    expect(Number(made[0]!.totalOwnerAmount)).toBe(720 + 780 + 720 + 780);
    expect(rows.every((r) => r.payoutId === null)).toBe(true); // (read before the payout was made)
  });

  test('the commission tier by booking number starts over each month too', async () => {
    const o = await org({ ...TERMS, commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE', value: 10 }, { fromBooking: 3, type: 'PERCENTAGE', value: 5 }] });
    const ids: string[] = [];
    for (const s of ['2026-09-29T10:00:00', '2026-09-30T10:00:00', '2026-09-30T20:00:00', '2026-10-01T10:00:00', '2026-10-02T10:00:00', '2026-10-03T10:00:00']) {
      ids.push(await playedAt(o.halfAId, ist(s)));
    }
    await settlements.completeAndSettle(ist('2026-10-05T00:30:00'));
    const rows = await Promise.all(ids.map(settlementOf));
    // September: 10%, 10%, then 5% from the third booking. October starts again at 10%, 10%, 5%.
    expect(rows.map((r) => Number(r.commission))).toEqual([80, 80, 40, 80, 80, 40]);
  });

  test('a venue in another timezone keeps its own month, while the payout week still follows the platform timezone', async () => {
    const o = await org({ ...TERMS, monthlyCommissionCap: 100, capPerUnit: false });
    // 23:30 UTC on 31 Oct is 19:30 on 31 Oct in New York, but already 05:00 on 1 Nov in Kolkata.
    const lateOctober = new Date('2026-10-31T23:30:00Z');
    // 04:30 UTC on 1 Nov is 00:30 on 1 Nov in New York (clocks go back at 02:00), 10:00 in Kolkata.
    const earlyNovember = new Date('2026-11-01T04:30:00Z');
    expect(periodMonthOf(lateOctober, 'America/New_York')).toBe('2026-10');
    expect(periodMonthOf(earlyNovember, 'America/New_York')).toBe('2026-11');
    expect(periodMonthOf(lateOctober, IST)).toBe('2026-11'); // the same instant is another month elsewhere

    const first = await playedAt(o.halfAId, lateOctober);
    const second = await playedAt(o.halfAId, earlyNovember);
    await prisma.venue.update({ where: { id: o.venueId }, data: { timezone: 'America/New_York' } }); // the venue's clock decides the month at settlement
    await settlements.completeAndSettle(ist('2026-11-03T00:00:00'));
    expect([(await settlementOf(first)).periodMonth, (await settlementOf(second)).periodMonth]).toEqual(['2026-10', '2026-11']);
    expect([Number((await settlementOf(first)).commission), Number((await settlementOf(second)).commission)]).toEqual([80, 80]); // a fresh cap each month

    // Both slots are on Sunday 1 Nov in Kolkata, so they share the payout of Monday 2 Nov (Kolkata).
    const made = mine(await payouts.createDuePayouts(ist('2026-11-03T00:00:00')), o.organizationId);
    expect(made).toHaveLength(1);
    expect(made[0]!.periodEnd.getTime()).toBe(ist('2026-11-02T00:00:00').getTime());
    expect(made[0]!.settlementCount).toBe(2);

    // When each month ends, in the venue's own clock, including the day the clocks change.
    expect(nextMonthStart('2026-10', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z'); // 00:00 EDT
    expect(nextMonthStart('2026-11', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z'); // 00:00 EST
    expect(nextMonthStart('2026-02', IST).toISOString()).toBe('2026-02-28T18:30:00.000Z'); // 1 March 00:00 IST
  });

  test('a late cancellation is paid to the owner but never counts toward the cap or the tier', async () => {
    const o = await org({ ...TERMS, monthlyCommissionCap: 100, capPerUnit: false });
    // A booking made for a slot a few days ahead (inside the 10-day window, outside 2 days), then cancelled by the customer:
    // 30% of what was paid goes back, 50% to the owner, the platform keeps the rest.
    const { agent, customerId } = await createCustomerFixture(app);
    await admin.post('/admin/coins/adjust').send({ customerId, signedAmount: 2000, reason: 'E2E top-up' });
    const start = futureStart(5, 10);
    const hold = await agent.post('/bookings/hold').send({ resourceId: o.halfAId, startTime: start.toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
    expect((await agent.post(`/bookings/${hold.body.id}/pay-with-coins`).send({})).status).toBe(201);
    expect((await agent.post(`/me/bookings/${hold.body.id}/cancel`).send({})).status).toBeLessThan(300);
    const late = await settlementOf(hold.body.id);
    expect(late.kind).toBe('LATE_CANCEL');
    expect([Number(late.collected), Number(late.refunded), Number(late.ownerAmount), Number(late.platformAmount)]).toEqual([800, 240, 400, 160]);
    expect(Number(late.commission) + Number(late.fee)).toBe(0);

    // It did not use up any of the owner's cap or move the tier: the next two played bookings are booking 1 and 2 of the month.
    const when = DateTime.fromJSDate(start).setZone(IST);
    const played = [await playedAt(o.halfBId, when.plus({ days: 1 }).startOf('day').plus({ hours: 8 }).toJSDate()), await playedAt(o.halfBId, when.plus({ days: 1 }).startOf('day').plus({ hours: 10 }).toJSDate())];
    const week = when.plus({ weeks: 2 }).toJSDate();
    await settlements.completeAndSettle(week);
    expect((await Promise.all(played.map(settlementOf))).map((r) => Number(r.commission))).toEqual([80, 20]);
    const counter = await prisma.venueCommissionMonth.findMany({ where: { venueId: o.venueId, categoryId: o.categoryId } });
    expect(counter.reduce((s, c) => s + c.bookingCount, 0)).toBe(2); // only the two played bookings

    // The late cancellation is in the payout of its slot's week, together with the played bookings of that week.
    const made = mine(await payouts.createDuePayouts(week), o.organizationId);
    const total = made.reduce((s, p) => s + Number(p.totalOwnerAmount), 0);
    expect(total).toBe(400 + 720 + 780);
    expect(made.reduce((s, p) => s + p.settlementCount, 0)).toBe(3);
  });

  // -------------------------------------------------------------------------------------------------------------------
  // The money
  // -------------------------------------------------------------------------------------------------------------------

  test('paise never go missing: what was paid is what the owner gets plus what the platform keeps, to the paisa', () => {
    const terms = { commissionTiers: [{ fromBooking: 1, type: 'PERCENTAGE' as const, value: 12.5 }], monthlyCommissionCap: null, afterCapFeePercent: 2.5 };
    for (const price of [1, 33.33, 99.99, 333.33, 1234.56, 799.99, 0.5]) {
      const minor = Math.round(price * 100);
      const r = settlePlayedBooking({ fullPriceMinor: minor, collectedMinor: minor, bookingsBefore: 0, commissionBeforeMinor: 0, terms });
      expect(Number.isInteger(r.commissionMinor) && Number.isInteger(r.ownerMinor)).toBe(true);
      expect(r.ownerMinor + r.platformMinor).toBe(minor);
      expect(r.ownerMinor).toBeGreaterThanOrEqual(0);
    }
    // Rounded to the nearest paisa: 12.5% of 33.33 is 4.16625 -> 4.17.
    expect(settlePlayedBooking({ fullPriceMinor: 3333, collectedMinor: 3333, bookingsBefore: 0, commissionBeforeMinor: 0, terms }).commissionMinor).toBe(417);
  });
});
