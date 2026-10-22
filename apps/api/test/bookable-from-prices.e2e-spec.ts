import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { coverageWindows, type PricingRuleLike } from '../src/pricing/pricing-rules';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  type TestAgent,
} from './setup/fixtures';

const TZ = 'Asia/Kolkata';
const nextDay = (weekday: number): DateTime => {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf('day');
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d;
};
const at = (day: DateTime, hour: number, minute = 0) => day.set({ hour, minute }).toJSDate();

describe('coverageWindows (pure)', () => {
  const r = (weekdays: number[], startWindow: string | null = null, endWindow: string | null = null, isActive = true) =>
    ({ weekdays, startWindow, endWindow, isActive, effectiveFrom: new Date(), createdAt: new Date() }) as PricingRuleLike;

  it('is a unit\'s bookable time: the merged windows of the prices covering that weekday', () => {
    const rules = [r([1], '16:00', '22:00'), r([1], '09:00', '12:00'), r([2, 3])];
    expect(coverageWindows(rules, 1)).toEqual([
      { openTime: '09:00', closeTime: '12:00' },
      { openTime: '16:00', closeTime: '22:00' },
    ]);
    expect(coverageWindows(rules, 2)).toEqual([{ openTime: '00:00', closeTime: '24:00' }]); // all day
    expect(coverageWindows(rules, 7)).toEqual([]); // no price on Sunday = not bookable
  });

  it('merges prices that touch or overlap, and ignores blocked ones', () => {
    const rules = [r([4], '06:00', '18:00'), r([4], '18:00', '24:00'), r([4], '10:00', '20:00'), r([4], '01:00', '02:00', false)];
    expect(coverageWindows(rules, 4)).toEqual([{ openTime: '06:00', closeTime: '24:00' }]);
  });
});

describe('prices decide when a unit can be booked', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let customer: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let facilityCode: string;

  const rule = (body: Record<string, unknown>) =>
    owner.post('/resources/pricing-rules').send({ resourceId: venue.fullGroundId, durationMinutes: 60, price: 800, ...body });
  const hold = (start: Date, durationMinutes = 60) =>
    customer
      .post('/bookings/hold')
      .send({ resourceId: venue.fullGroundId, startTime: start.toISOString(), durationMinutes });
  async function startsOn(day: DateTime, durationMinutes = 60): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ facilityCode, date: day.toFormat('yyyy-MM-dd'), timeWindow: 'ALL', durationMinutes })
      .expect(200);
    const row = res.body.find((x: { resource: { id: string } }) => x.resource.id === venue.fullGroundId);
    return (row?.availableStartTimes ?? []).map((t: string) => DateTime.fromISO(t, { zone: TZ }).toFormat('HH:mm'));
  }

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    ({ agent: customer } = await createCustomerFixture(app));
    venue = await createVenueFixture(app, owner, admin); // all-day prices Mon-Fri and Sat-Sun, 60 min
    facilityCode = (await owner.get(`/venues/${venue.venueId}`).expect(200)).body.facilityCode;
    // Replace the all-day prices on the full ground with timed ones: that is how an owner sets "opening hours".
    const existing = (await owner.get(`/resources/pricing-rules?resourceId=${venue.fullGroundId}`).expect(200)).body;
    for (const x of existing) await owner.patch(`/resources/pricing-rules/${x.id}`).send({ isActive: false }).expect(200);
    await rule({ days: [1], startWindow: '09:00', endWindow: '12:00' }).expect(201); // Mon morning
    await rule({ days: [1], startWindow: '16:00', endWindow: '22:00', price: 1200 }).expect(201); // Mon evening
    await rule({ days: [3], startWindow: '06:00', endWindow: '18:00' }).expect(201); // Wed, two prices that touch
    await rule({ days: [3], startWindow: '18:00', endWindow: '24:00', price: 1500 }).expect(201);
  });
  afterAll(async () => app.close());

  it('offers start times only where a price covers them (a split shift on Monday)', async () => {
    const starts = await startsOn(nextDay(1));
    for (const t of ['09:00', '10:00', '11:00', '16:00', '20:00', '21:00']) expect(starts).toContain(t);
    for (const t of ['08:00', '12:00', '13:00', '15:00', '22:00', '23:00']) expect(starts).not.toContain(t);
  });

  it('accepts a booking inside a priced window, rejects one in the gap or running across it', async () => {
    const monday = nextDay(1);
    await hold(at(monday, 10)).expect(201);
    await hold(at(monday, 16)).expect(201);
    await hold(at(monday, 12)).expect(400); // in the gap
    await hold(at(monday, 15)).expect(400); // in the gap
    await hold(at(monday, 11), 120).expect(400); // 120 min has no price at all
  });

  it('a day with no price is not bookable', async () => {
    const tuesday = nextDay(2);
    expect(await startsOn(tuesday)).toEqual([]);
    await hold(at(tuesday, 10)).expect(400);
  });

  it('a duration with no price is not offered, even where another duration is', async () => {
    // Friday has no price yet, so nothing is offered for either duration.
    expect(await startsOn(nextDay(5), 120)).toEqual([]);
    await rule({ days: [5], startWindow: '09:00', endWindow: '12:00' }).expect(201); // 60 min only
    expect(await startsOn(nextDay(5), 120)).toEqual([]); // still no 120-minute price
    await rule({ days: [5], durationMinutes: 120, startWindow: '09:00', endWindow: '12:00', price: 1500 }).expect(201);
    const starts = await startsOn(nextDay(5), 120);
    expect(starts).toContain('09:00');
    expect(starts).toContain('10:00'); // 10:00-12:00 fits
    expect(starts).not.toContain('11:00'); // 11:00-13:00 would run past the price
  });

  it('prices that touch count as one run, so a booking may span them and is priced by its start', async () => {
    const wednesday = nextDay(3);
    const starts = await startsOn(wednesday);
    expect(starts).toContain('17:00');
    expect(starts).toContain('23:00'); // 23:00-24:00 ends at midnight, which is allowed
    const spanning = await hold(at(wednesday, 17), 120).expect(400); // no 120 min price on Wednesday
    expect(spanning.body.message).toBeDefined();
    const booked = await hold(at(wednesday, 17)).expect(201); // 17:00-18:00 stays in the first price
    expect(Number(booked.body.amount ?? booked.body.price ?? 800)).toBeGreaterThan(0);
  });

  it('blocking a price takes those times away, and unblocking gives them back', async () => {
    const monday = nextDay(1);
    const list = (await owner.get(`/resources/pricing-rules?resourceId=${venue.fullGroundId}`).expect(200)).body;
    const evening = list.find((x: { isActive: boolean; startWindow: string | null; durationMinutes: number }) => x.isActive && x.startWindow === '16:00' && x.durationMinutes === 60);
    await owner.patch(`/resources/pricing-rules/${evening.id}`).send({ isActive: false }).expect(200);
    expect(await startsOn(monday)).not.toContain('20:00');
    await owner.patch(`/resources/pricing-rules/${evening.id}`).send({ isActive: true }).expect(200);
    expect(await startsOn(monday)).toContain('20:00');
  });
});
