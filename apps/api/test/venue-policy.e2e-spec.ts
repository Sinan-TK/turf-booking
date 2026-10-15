import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
  type TestAgent,
} from './setup/fixtures';

const TZ = 'Asia/Kolkata';

/** Venue-local wall clock `daysFromNow` days ahead at hh:mm:ss. */
function localStart(daysFromNow: number, hour: number, minute = 0, second = 0): Date {
  return DateTime.now()
    .setZone(TZ)
    .plus({ days: daysFromNow })
    .set({ hour, minute, second, millisecond: 0 })
    .toJSDate();
}
const localDate = (d: Date) => DateTime.fromJSDate(d, { zone: TZ }).toISODate()!;
const hhmm = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toFormat('HH:mm');

/**
 * Phase 2: policy-driven availability & booking. Search and holds share one
 * resolved BookingPolicy (interval grid, durations, lead time, advance
 * window, buffers), opening hours and blocked periods are enforced on holds,
 * and buffers ride on the existing resource-lock exclusion constraint.
 */
describe('Venue policy engine', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let customer: TestAgent;

  const basePolicy = {
    slotIntervalMin: 30,
    minDurationMin: 30,
    maxDurationMin: 120,
    durationIncrementMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    maxAdvanceDays: 30,
    minLeadMinutes: 0,
  };

  interface Venue {
    categoryId: string;
    venueId: string;
    facilityCode: string;
    resourceId: string;
  }

  /**
   * A venue of a fresh category with the given policy and opening hours
   * (every weekday), one resource, and 30/60 minute prices.
   */
  async function createVenue(
    policy: Partial<typeof basePolicy>,
    hours: [string, string] = ['10:00', '14:00'],
    prices: number[] = [30, 60],
  ): Promise<Venue> {
    const slug = `E2E_${uniqueSuffix().toUpperCase()}`;
    const category = await adminAgent.post('/admin/categories').send({
      slug,
      name: `E2E ${slug}`,
      unitLabel: 'Board',
      venueLabel: 'Chess club',
      policy: { ...basePolicy, ...policy },
    });
    expect(category.status).toBe(201);

    const states = await request(app.getHttpServer()).get('/states');
    const districts = await request(app.getHttpServer()).get(`/districts?stateId=${states.body[0].id}`);
    const venue = await ownerAgent.post('/venues').send({
      name: `E2E Chess ${uniqueSuffix()}`,
      districtId: districts.body[0].id,
      address: '1 Test Lane',
      lat: 10,
      lng: 76,
      timezone: TZ,
      categoryId: category.body.id,
    });
    expect(venue.status).toBe(201);
    expect((await adminAgent.patch(`/venues/${venue.body.id}`).send({ status: 'ACTIVE' })).status).toBe(200);

    const resource = await ownerAgent
      .post('/resources')
      .send({ venueId: venue.body.id, name: 'Board 1', groundType: 'Standard' });
    expect(resource.status).toBe(201);

    await Promise.all([
      ...[0, 1, 2, 3, 4, 5, 6].map((weekday) =>
        ownerAgent
          .put('/venue-config/operating-hours')
          .send({ venueId: venue.body.id, weekday, openTime: hours[0], closeTime: hours[1] })
          .then((r) => expect(r.status).toBe(200)),
      ),
      ...prices.flatMap((duration) =>
        ['WEEKDAY', 'WEEKEND'].map((dayType) =>
          ownerAgent
            .post('/resources/pricing-rules')
            .send({ resourceId: resource.body.id, durationMinutes: duration, dayType, price: duration * 2 })
            .then((r) => expect(r.status).toBe(201)),
        ),
      ),
    ]);

    return {
      categoryId: category.body.id,
      venueId: venue.body.id,
      facilityCode: venue.body.facilityCode,
      resourceId: resource.body.id,
    };
  }

  const hold = (resourceId: string, startTime: Date, durationMinutes: number, agent = customer) =>
    agent.post('/bookings/hold').send({ resourceId, startTime: startTime.toISOString(), durationMinutes });

  const search = (facilityCode: string, day: Date, durationMinutes: number) =>
    request(app.getHttpServer()).get('/search').query({
      facilityCode,
      date: localDate(day),
      timeWindow: 'ALL',
      durationMinutes,
    });

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    ({ agent: customer } = await createCustomerFixture(app));
  });

  afterAll(async () => {
    await prisma.venueCategory.updateMany({
      where: { slug: { startsWith: 'E2E_' } },
      data: { isActive: false },
    });
    await app.close();
  });

  describe('chess venue: 30-minute interval, 30–120 minute durations', () => {
    let v: Venue;
    beforeAll(async () => {
      v = await createVenue({});
    });

    test('search returns 30-minute slots inside opening hours, with the policy', async () => {
      const day = localStart(3, 12);
      const res30 = await search(v.facilityCode, day, 30);
      expect(res30.status).toBe(200);
      expect(res30.body).toHaveLength(1);
      expect(res30.body[0].availableStartTimes.map(hhmm)).toEqual([
        '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
      ]);
      expect(res30.body[0].policy).toMatchObject({
        slotIntervalMin: 30,
        minDurationMin: 30,
        maxDurationMin: 120,
        durations: [30, 60, 90, 120],
      });
      expect(res30.body[0].category.venueLabel).toBe('Chess club');
      expect(res30.body[0].price).toEqual({ amount: '60', currency: 'INR' });

      // A 60-minute game must still finish by closing time: last start 13:00.
      const res60 = await search(v.facilityCode, day, 60);
      expect(res60.body[0].availableStartTimes.map(hhmm).slice(-1)).toEqual(['13:00']);
      expect(res60.body[0].availableStartTimes).toHaveLength(7);
    });

    test('a hold at :30 succeeds; :15, sub-minute offsets and bad durations are rejected, never rounded', async () => {
      const ok = await hold(v.resourceId, localStart(4, 10, 30), 30);
      expect(ok.status).toBe(201);
      expect(ok.body.durationMinutes).toBe(30);

      const quarter = await hold(v.resourceId, localStart(4, 11, 15), 30);
      expect(quarter.status).toBe(400);
      expect(quarter.body.message).toMatch(/30-minute boundary/);
      expect((await hold(v.resourceId, localStart(4, 11, 0, 30), 30)).status).toBe(400);

      // 45 is off the increment grid, 150 is above the maximum, 15 below the minimum.
      for (const bad of [45, 150, 15]) {
        const r = await hold(v.resourceId, localStart(4, 12, 0), bad);
        expect(r.status).toBe(400);
        expect(r.body.message).toMatch(/Duration must be between 30 and 120/);
      }
    });

    test('opening hours are enforced on holds, not only in search', async () => {
      const early = await hold(v.resourceId, localStart(5, 9, 30), 30);
      expect(early.status).toBe(400);
      expect(early.body.message).toMatch(/opening hours/);
      // 13:30 + 60 min ends 14:30, after the 14:00 close.
      expect((await hold(v.resourceId, localStart(5, 13, 30), 60)).status).toBe(400);
      expect((await hold(v.resourceId, localStart(5, 13, 30), 30)).status).toBe(201);
    });

    test('a duration the policy allows but nobody priced is rejected, not invented', async () => {
      const unpriced = await hold(v.resourceId, localStart(6, 10, 0), 90);
      expect(unpriced.status).toBe(400);
      expect(unpriced.body.message).toMatch(/No pricing configured/);

      const res = await search(v.facilityCode, localStart(6, 12), 90);
      expect(res.body[0].price).toBeNull();
    });

    test('pricing rules can only be created for durations the policy offers', async () => {
      const bad = await ownerAgent.post('/resources/pricing-rules').send({
        resourceId: v.resourceId,
        durationMinutes: 45,
        dayType: 'WEEKDAY',
        price: 10,
      });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/allowed: 30, 60, 90, 120/);
    });

    test('concurrent holds on one slot: exactly one wins, the rest get a conflict', async () => {
      const when = localStart(7, 11, 30);
      const holders = await Promise.all(
        Array.from({ length: 5 }, () => createCustomerFixture(app)),
      );
      const results = await Promise.all(holders.map((h) => hold(v.resourceId, when, 30, h.agent)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    });

    test('blocked periods stop holds and search, are mirrored in blocked_periods, and lift on delete', async () => {
      const day = 8;
      const blocked = await ownerAgent.post('/venue-config/blocked-dates').send({
        venueId: v.venueId,
        startTime: localStart(day, 11, 0).toISOString(),
        endTime: localStart(day, 12, 0).toISOString(),
        reason: 'Tournament',
      });
      expect(blocked.status).toBe(201);
      expect(await prisma.blockedPeriod.count({ where: { sourceBlockedDateId: blocked.body.id } })).toBe(1);

      expect((await hold(v.resourceId, localStart(day, 11, 0), 30)).status).toBe(409);
      expect((await hold(v.resourceId, localStart(day, 10, 30), 60)).status).toBe(409);
      const times = (await search(v.facilityCode, localStart(day, 12), 30)).body[0].availableStartTimes.map(hhmm);
      expect(times).not.toContain('11:00');
      expect(times).not.toContain('11:30');
      expect(times).toContain('12:00');
      expect((await hold(v.resourceId, localStart(day, 12, 0), 30)).status).toBe(201);

      await ownerAgent.delete(`/venue-config/blocked-dates/${blocked.body.id}`);
      expect(await prisma.blockedPeriod.count({ where: { sourceBlockedDateId: blocked.body.id } })).toBe(0);
      expect((await hold(v.resourceId, localStart(day, 11, 0), 30)).status).toBe(201);
    });

    test('operating hours are dual-written: one twin rule per weekday, updated in place', async () => {
      const before = await prisma.availabilityRule.count({ where: { venueId: v.venueId } });
      expect(before).toBe(7);
      const res = await ownerAgent
        .put('/venue-config/operating-hours')
        .send({ venueId: v.venueId, weekday: 2, openTime: '10:00', closeTime: '14:00' });
      expect(res.status).toBe(200);
      expect(await prisma.availabilityRule.count({ where: { venueId: v.venueId } })).toBe(7);
      const legacy = await prisma.operatingHours.count({ where: { venueId: v.venueId } });
      expect(legacy).toBe(7);
    });
  });

  describe('buffers (15-minute clean-up after each game)', () => {
    let v: Venue;
    beforeAll(async () => {
      v = await createVenue({ bufferAfterMin: 30 }, ['10:00', '16:00']);
    });

    test('the lock covers booking + buffer; the next slot opens after the gap; search agrees', async () => {
      const day = 9;
      const first = await hold(v.resourceId, localStart(day, 10, 0), 60);
      expect(first.status).toBe(201);

      // Booking keeps its own times; only the lock is padded.
      const locks = await prisma.resourceLock.findMany({ where: { slotHoldId: first.body.slotHoldId } });
      expect(hhmm(first.body.endTime)).toBe('11:00');
      expect(locks.length).toBeGreaterThan(0);
      for (const lock of locks) {
        expect(hhmm(lock.startTime.toISOString())).toBe('10:00');
        expect(hhmm(lock.endTime.toISOString())).toBe('11:30');
      }

      const times = (await search(v.facilityCode, localStart(day, 12), 30)).body[0].availableStartTimes.map(hhmm);
      expect(times).not.toContain('11:00'); // inside the buffer
      expect(times).toContain('11:30');

      expect((await hold(v.resourceId, localStart(day, 11, 0), 30)).status).toBe(409);
      const next = await hold(v.resourceId, localStart(day, 11, 30), 30);
      expect(next.status).toBe(201);
    });

    test('cancelling a booking frees its buffer too', async () => {
      const day = 10;
      const a = await hold(v.resourceId, localStart(day, 12, 0), 60);
      expect(a.status).toBe(201);
      expect((await hold(v.resourceId, localStart(day, 13, 0), 30)).status).toBe(409);
      const cancel = await customer.post(`/me/bookings/${a.body.id}/cancel`).send({});
      expect(cancel.status).toBeLessThan(300);
      expect((await hold(v.resourceId, localStart(day, 13, 0), 30)).status).toBe(201);
    });
  });

  describe('lead time and advance window', () => {
    let v: Venue;
    beforeAll(async () => {
      v = await createVenue({ minLeadMinutes: 120, maxAdvanceDays: 3 }, ['00:00', '23:59']);
    });

    test('too soon and too far ahead are rejected; in-window succeeds', async () => {
      const soon = DateTime.now().setZone(TZ).plus({ minutes: 45 });
      const aligned = soon.set({ minute: Math.ceil(soon.minute / 30) * 30 % 60, second: 0, millisecond: 0 });
      const tooSoon = aligned < soon ? aligned.plus({ hours: 1 }) : aligned;
      const early = await hold(v.resourceId, tooSoon.toJSDate(), 30);
      expect(early.status).toBe(400);
      expect(early.body.message).toMatch(/at least 120 minutes/);

      const far = await hold(v.resourceId, localStart(6, 10), 30);
      expect(far.status).toBe(400);
      expect(far.body.message).toMatch(/at most 3 days/);

      expect((await hold(v.resourceId, localStart(1, 10), 30)).status).toBe(201);
    });

    test('search hides slots inside the lead time and beyond the advance window', async () => {
      const far = await search(v.facilityCode, localStart(6, 12), 30);
      expect(far.body).toHaveLength(0);
      const ok = await search(v.facilityCode, localStart(1, 12), 30);
      expect(ok.body[0].availableStartTimes.length).toBeGreaterThan(0);
    });
  });

  describe('policy precedence: RESOURCE > VENUE > CATEGORY', () => {
    test('narrower scopes override wider ones in search and holds', async () => {
      const v = await createVenue({}, ['10:00', '14:00']);
      const day = localStart(3, 12);
      const slotsFor = async () => (await search(v.facilityCode, day, 60)).body[0].availableStartTimes.map(hhmm);
      expect((await slotsFor())[1]).toBe('10:30'); // category: 30-minute grid

      // VENUE scope: hourly grid.
      const venuePolicy = await prisma.bookingPolicy.create({
        data: { ...basePolicy, scope: 'VENUE', venueId: v.venueId, slotIntervalMin: 60, minDurationMin: 60, durationIncrementMin: 60 },
      });
      expect((await slotsFor())[1]).toBe('11:00');
      expect((await hold(v.resourceId, localStart(3, 10, 30), 60)).status).toBe(400);

      // RESOURCE scope: 15-minute grid wins over the venue.
      const resourcePolicy = await prisma.bookingPolicy.create({
        data: { ...basePolicy, scope: 'RESOURCE', resourceId: v.resourceId, slotIntervalMin: 15 },
      });
      expect((await slotsFor())[1]).toBe('10:15');
      expect((await hold(v.resourceId, localStart(3, 10, 15), 60)).status).toBe(201);

      await prisma.bookingPolicy.deleteMany({ where: { id: { in: [venuePolicy.id, resourcePolicy.id] } } });
      // Back on the category's 30-minute grid (the 10:15 hold above still
      // occupies 10:15–11:15, so the first free half-hour start is 11:30).
      const restored = await slotsFor();
      expect(restored).toContain('11:30');
      expect(restored.every((t: string) => t.endsWith(':00') || t.endsWith(':30'))).toBe(true);
    });
  });

  describe('football is unchanged', () => {
    test('hourly grid, 60/120/180 only, whole-hour starts', async () => {
      const fixture = await createVenueFixture(app, ownerAgent, adminAgent);
      const venue = await prisma.venue.findUniqueOrThrow({ where: { id: fixture.venueId } });
      const day = localStart(3, 12);

      const hourly = await search(venue.facilityCode, day, 60);
      const slots = hourly.body.find((r: { resource: { id: string } }) => r.resource.id === fixture.halfAId);
      expect(slots.policy).toMatchObject({
        slotIntervalMin: 60,
        minDurationMin: 60,
        maxDurationMin: 180,
        durationIncrementMin: 60,
        durations: [60, 120, 180],
      });
      expect(slots.availableStartTimes.map(hhmm).every((t: string) => t.endsWith(':00'))).toBe(true);
      expect(slots.category.slug).toBe('FOOTBALL_TURF');

      // 30 minutes is not offered by football, so there is nothing to show.
      expect((await search(venue.facilityCode, day, 30)).body).toHaveLength(0);

      const half = await hold(fixture.halfAId, localStart(3, 10, 30), 60);
      expect(half.status).toBe(400);
      expect((await hold(fixture.halfAId, localStart(3, 10, 0), 240)).status).toBe(400);
      expect((await hold(fixture.halfAId, localStart(3, 10, 0), 60)).status).toBe(201);
      // The existing composition rule still holds: 7s full conflicts with a 5s half.
      expect((await hold(fixture.fullGroundId, localStart(3, 10, 0), 60)).status).toBe(409);
    });
  });

  describe('tenant isolation on configuration reads', () => {
    test("an owner cannot read another organization's pricing, hours or blocks", async () => {
      const v = await createVenue({});
      const { ownerAgent: other } = await createOwnerFixture(app, adminAgent);
      expect((await other.get(`/resources/pricing-rules?resourceId=${v.resourceId}`)).status).toBe(403);
      expect((await other.get(`/venue-config/operating-hours?venueId=${v.venueId}`)).status).toBe(403);
      expect((await other.get(`/venue-config/blocked-dates?venueId=${v.venueId}`)).status).toBe(403);

      const own = await ownerAgent.get(`/resources/pricing-rules?resourceId=${v.resourceId}`);
      expect(own.status).toBe(200);
      expect(own.body.length).toBeGreaterThan(0);
      // Without a filter an owner only ever sees their own organization's rules.
      const all = await other.get('/resources/pricing-rules');
      expect(all.status).toBe(200);
      expect(all.body.some((r: { resourceId: string }) => r.resourceId === v.resourceId)).toBe(false);
    });
  });

  describe('owner walk-in bookings follow the grid but not lead time', () => {
    test('a walk-in on the half hour works, off-grid is rejected', async () => {
      const v = await createVenue({ minLeadMinutes: 600 }, ['10:00', '14:00']);
      const base = {
        resourceId: v.resourceId,
        durationMinutes: 30,
        customerWhatsappNumber: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      };
      const ok = await ownerAgent
        .post('/owner/bookings')
        .send({ ...base, startTime: localStart(2, 10, 30).toISOString() });
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('CONFIRMED');
      const bad = await ownerAgent
        .post('/owner/bookings')
        .send({ ...base, startTime: localStart(2, 11, 15).toISOString() });
      expect(bad.status).toBe(400);
    });
  });
});
