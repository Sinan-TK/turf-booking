import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import { describeRule, pickPricingRule, rulesOverlap, type PricingRuleLike } from '../src/pricing/pricing-rules';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

const TZ = 'Asia/Kolkata';

/** The next given ISO weekday (1 = Mon .. 7 = Sun) at least `minDays` ahead, at `hour:00` venue time. */
function nextLocal(weekday: number, hour: number, minDays = 3): Date {
  let d = DateTime.now().setZone(TZ).plus({ days: minDays }).set({ hour, minute: 0, second: 0, millisecond: 0 });
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d.toJSDate();
}

describe('pickPricingRule (pure)', () => {
  const rule = (over: Partial<PricingRuleLike> & { price: number }): PricingRuleLike & { price: number } => ({
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startWindow: null,
    endWindow: null,
    effectiveFrom: new Date('2020-01-01'),
    createdAt: new Date('2020-01-01'),
    ...over,
  });
  const at = (iso: string) => new Date(iso);

  it('matches on the venue-local day, not the server day', () => {
    // 2026-10-17 20:00 UTC is already Sunday 01:30 in Kolkata.
    const weekendOnly = rule({ weekdays: [6, 7], price: 1 });
    expect(pickPricingRule([weekendOnly], at('2026-10-17T20:00:00Z'), TZ)).toBe(weekendOnly);
    expect(pickPricingRule([weekendOnly], at('2026-10-17T20:00:00Z'), 'UTC')).toBe(weekendOnly); // Saturday in UTC too
    expect(pickPricingRule([weekendOnly], at('2026-10-15T08:00:00Z'), TZ)).toBeNull(); // Thursday
  });

  it('honours the time window by slot start, [start, end)', () => {
    const evening = rule({ startWindow: '18:00', endWindow: '23:00', price: 2 });
    // 18:00 IST = 12:30Z
    expect(pickPricingRule([evening], at('2026-10-15T12:30:00Z'), TZ)).toBe(evening);
    expect(pickPricingRule([evening], at('2026-10-15T12:29:00Z'), TZ)).toBeNull();
    expect(pickPricingRule([evening], at('2026-10-15T17:30:00Z'), TZ)).toBeNull(); // 23:00 is excluded
  });

  it('prefers a time window over an all-day rule, and a shorter window over a longer one', () => {
    const allDay = rule({ price: 1 });
    const evening = rule({ startWindow: '18:00', endWindow: '23:00', price: 2 });
    const peak = rule({ startWindow: '19:00', endWindow: '21:00', price: 3 });
    const t = at('2026-10-15T14:00:00Z'); // 19:30 IST
    expect(pickPricingRule([allDay, evening], t, TZ)).toBe(evening);
    expect(pickPricingRule([allDay, evening, peak], t, TZ)).toBe(peak);
    expect(pickPricingRule([allDay, evening, peak], at('2026-10-15T05:00:00Z'), TZ)).toBe(allDay); // 10:30 IST
  });

  it('among equals the newest rule wins, and a future-dated rule is ignored until it starts', () => {
    const old = rule({ price: 1, createdAt: new Date('2025-01-01') });
    const fresh = rule({ price: 2, createdAt: new Date('2026-01-01') });
    const scheduled = rule({ price: 3, effectiveFrom: new Date('2030-01-01'), createdAt: new Date('2026-06-01') });
    expect(pickPricingRule([old, fresh, scheduled], at('2026-10-15T05:00:00Z'), TZ)).toBe(fresh);
    expect(pickPricingRule([old, fresh, scheduled], at('2031-01-02T05:00:00Z'), TZ)).toBe(scheduled);
  });

  it('reads a legacy row (no weekdays, only a dayType) as before', () => {
    const legacy = rule({ weekdays: [], dayType: 'WEEKDAY', price: 1 });
    expect(pickPricingRule([legacy], at('2026-10-15T05:00:00Z'), TZ)).toBe(legacy); // Thursday
    expect(pickPricingRule([legacy], at('2026-10-17T05:00:00Z'), TZ)).toBeNull(); // Saturday
  });
});


describe('rulesOverlap (pure)', () => {
  const r = (weekdays: number[], startWindow: string | null = null, endWindow: string | null = null) => ({
    weekdays,
    startWindow,
    endWindow,
    effectiveFrom: new Date(),
    createdAt: new Date(),
  });

  it('needs a shared day AND a shared time', () => {
    expect(rulesOverlap(r([1, 2, 3]), r([4, 5]))).toBe(false); // no shared day
    expect(rulesOverlap(r([1, 2, 3]), r([3, 4]))).toBe(true); // all day vs all day on Wednesday
    expect(rulesOverlap(r([5], '06:00', '18:00'), r([5], '18:00', '24:00'))).toBe(false); // back to back
    expect(rulesOverlap(r([5], '06:00', '18:00'), r([5], '17:00', '24:00'))).toBe(true);
    expect(rulesOverlap(r([5]), r([5], '18:00', '23:00'))).toBe(true); // all day covers every hour
  });

  it('describes a rule for error messages', () => {
    const rule = { ...r([5, 6, 7], '18:00', '24:00'), durationMinutes: 60, normalPrice: 1500, currency: 'INR' };
    expect(describeRule(rule)).toBe('Fri–Sun, 6:00 pm – midnight, 60 min at INR 1500');
  });
});

describe('owner price rules: days, hours, blocking and overlaps', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let other: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  // The fixture prices halfA at 800 Mon-Fri and 800 Sat-Sun (all day, 60 min).
  let weekdayRuleId: string;
  let weekendRuleId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, owner, admin);
    const rules = await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`).expect(200);
    weekdayRuleId = rules.body.find((x: { weekdays: number[] }) => x.weekdays.length === 5).id;
    weekendRuleId = rules.body.find((x: { weekdays: number[] }) => x.weekdays.length === 2).id;
  });
  afterAll(async () => app.close());

  const rule = (body: Record<string, unknown>) =>
    owner.post('/resources/pricing-rules').send({ resourceId: venue.halfAId, durationMinutes: 60, price: 1500, ...body });
  /** Blocks every price of a unit, so a new one can be added without clashing. */
  async function blockAll(resourceId: string) {
    const list = await owner.get(`/resources/pricing-rules?resourceId=${resourceId}`).expect(200);
    for (const x of list.body) await owner.patch(`/resources/pricing-rules/${x.id}`).send({ isActive: false }).expect(200);
  }
  const book = (start: Date) =>
    owner.post('/owner/bookings').send({
      resourceId: venue.halfAId,
      durationMinutes: 60,
      customerWhatsappNumber: '+919800002222',
      startTime: start.toISOString(),
    });

  it('refuses a price that overlaps an active one, and names the clash', async () => {
    const res = await rule({ days: [5, 6, 7], startWindow: '18:00', endWindow: '24:00' }).expect(409);
    expect(res.body.message).toMatch(/overlaps an existing price/i);
    expect(res.body.message).toMatch(/Mon–Fri, all day, 60 min at INR 800/);
    await rule({ days: [3] }).expect(409); // a Wednesday all-day price clashes with Mon-Fri too
  });

  it('allows non-overlapping prices once the old ones are blocked, and prices by day and hour', async () => {
    await owner.patch(`/resources/pricing-rules/${weekdayRuleId}`).send({ isActive: false }).expect(200);
    await owner.patch(`/resources/pricing-rules/${weekendRuleId}`).send({ isActive: false }).expect(200);

    await rule({ days: [1, 2, 3, 4], price: 800 }).expect(201); // Mon-Thu, all day
    await rule({ days: [5, 6, 7], startWindow: '00:00', endWindow: '18:00', price: 800 }).expect(201);
    const evening = await rule({ days: [5, 6, 7], startWindow: '18:00', endWindow: '24:00', price: 1500 }).expect(201);

    expect(Number((await book(nextLocal(5, 19)).expect(201)).body.amount)).toBe(1500);
    expect(Number((await book(nextLocal(5, 10)).expect(201)).body.amount)).toBe(800);
    expect(Number((await book(nextLocal(6, 10)).expect(201)).body.amount)).toBe(800);
    expect(Number((await book(nextLocal(4, 19)).expect(201)).body.amount)).toBe(800);

    // Blocking the evening price leaves Friday evening with no price, so it can't be booked.
    await owner.patch(`/resources/pricing-rules/${evening.body.id}`).send({ isActive: false }).expect(200);
    await book(nextLocal(5, 20)).expect(400);

    // ...and turning it back on prices it again.
    await owner.patch(`/resources/pricing-rules/${evening.body.id}`).send({ isActive: true }).expect(200);
    expect(Number((await book(nextLocal(5, 20)).expect(201)).body.amount)).toBe(1500);
  });

  it('refuses to turn a blocked price back on while something would override it', async () => {
    // weekdayRuleId (Mon-Fri all day) is still blocked, and Mon-Thu / Fri windows now exist.
    const res = await owner.patch(`/resources/pricing-rules/${weekdayRuleId}`).send({ isActive: true }).expect(409);
    expect(res.body.message).toMatch(/overlaps an existing price/i);
    // Turning on something already on is a harmless no-op.
    const evening = (await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`)).body.find(
      (x: { price: string; isActive: boolean }) => Number(x.price) === 1500 && x.isActive,
    );
    await owner.patch(`/resources/pricing-rules/${evening.id}`).send({ isActive: true }).expect(200);
  });

  it('a blocked price does not count as an overlap, and can be removed', async () => {
    // A unit's prices are per block, so a different duration in the body no longer sidesteps a clash.
    await rule({ days: [7], price: 999, durationMinutes: 120 }).expect(409);
    const list = await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`).expect(200);
    expect(list.body.some((x: { id: string; isActive: boolean }) => x.id === weekdayRuleId && !x.isActive)).toBe(true);
    await other.patch(`/resources/pricing-rules/${weekdayRuleId}`).send({ isActive: true }).expect(403);
    await other.delete(`/resources/pricing-rules/${weekdayRuleId}`).expect(403);
    await owner.delete(`/resources/pricing-rules/${weekdayRuleId}`).expect(200);
    await owner.delete(`/resources/pricing-rules/${weekdayRuleId}`).expect(404);
  });

  it('still accepts the legacy dayType shorthand', async () => {
    await blockAll(venue.halfBId);
    const res = await rule({ dayType: 'WEEKEND', price: 999, resourceId: venue.halfBId }).expect(201);
    expect(res.body.weekdays).toEqual([6, 7]);
  });

  it('rejects rules with no days, a half or backwards time window, or a bad day', async () => {
    await blockAll(venue.halfAId);
    const base = { price: 100 };
    await rule(base).expect(400);
    await rule({ ...base, days: [] }).expect(400);
    await rule({ ...base, days: [8] }).expect(400);
    await rule({ ...base, days: [1], startWindow: '18:00' }).expect(400);
    await rule({ ...base, days: [1], startWindow: '20:00', endWindow: '18:00' }).expect(400);
    await rule({ ...base, days: [1], startWindow: '18:00', endWindow: '25:00' }).expect(400);
    await rule({ ...base, days: [1], startWindow: '18:00', endWindow: '24:00' }).expect(201);
  });
});

describe('editing a price', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let other: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let weekday: { id: string };
  let weekend: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, owner, admin); // halfA: Mon-Fri 800, Sat-Sun 800, 60 min
    const rules = (await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`).expect(200)).body;
    weekday = rules.find((x: { weekdays: number[] }) => x.weekdays.length === 5);
    weekend = rules.find((x: { weekdays: number[] }) => x.weekdays.length === 2);
  });
  afterAll(async () => app.close());

  const patch = (id: string, body: Record<string, unknown>) => owner.patch(`/resources/pricing-rules/${id}`).send(body);

  it('changes the amount, and bookings use the new amount', async () => {
    const res = await patch(weekday.id, { price: 900 }).expect(200);
    expect(Number(res.body.price)).toBe(900);
    const booked = await owner
      .post('/owner/bookings')
      .send({
        resourceId: venue.halfAId,
        durationMinutes: 60,
        customerWhatsappNumber: '+919800003333',
        startTime: nextLocal(3, 10).toISOString(),
      })
      .expect(201);
    expect(Number(booked.body.amount)).toBe(900);
  });

  it('can narrow the days and hours, and go back to all day with nulls', async () => {
    const timed = await patch(weekday.id, { days: [1, 2, 3], startWindow: '06:00', endWindow: '18:00' }).expect(200);
    expect(timed.body.weekdays).toEqual([1, 2, 3]);
    expect(timed.body.startWindow).toBe('06:00');
    const allDay = await patch(weekday.id, { days: [1, 2, 3, 4, 5], startWindow: null, endWindow: null }).expect(200);
    expect(allDay.body.startWindow).toBeNull();
    expect(allDay.body.endWindow).toBeNull();
  });

  it('refuses an edit that would overlap another active price, naming it', async () => {
    const res = await patch(weekday.id, { days: [1, 2, 3, 4, 5, 6] }).expect(409); // Saturday clashes with Sat-Sun
    expect(res.body.message).toMatch(/overlaps an existing price/i);
    expect(res.body.message).toMatch(/Sat, Sun, all day, 60 min at INR 800/);
    // The same edit is fine once the other price is blocked.
    await patch(weekend.id, { isActive: false }).expect(200);
    await patch(weekday.id, { days: [1, 2, 3, 4, 5, 6] }).expect(200);
    await patch(weekend.id, { isActive: true }).expect(409); // and now the weekend price can't come back
  });

  it('ignores a duration (a unit\'s price is per block of its shortest booking), and rejects bad bodies', async () => {
    const before = (await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`).expect(200)).body.find((x: { id: string }) => x.id === weekday.id);
    await patch(weekday.id, { durationMinutes: 45 }).expect(200);
    const after = (await owner.get(`/resources/pricing-rules?resourceId=${venue.halfAId}`).expect(200)).body.find((x: { id: string }) => x.id === weekday.id);
    expect(after.durationMinutes).toBe(before.durationMinutes);
    await patch(weekday.id, {}).expect(400);
    await patch(weekday.id, { startWindow: '10:00' }).expect(400);
    await patch(weekday.id, { startWindow: null, endWindow: '10:00' }).expect(400);
    await patch(weekday.id, { startWindow: '12:00', endWindow: '10:00' }).expect(400);
    await patch(weekday.id, { days: [] }).expect(400);
    await patch(weekday.id, { price: -1 }).expect(400);
  });

  it("another organization cannot edit this venue's prices", async () => {
    await other.patch(`/resources/pricing-rules/${weekday.id}`).send({ price: 1 }).expect(403);
  });
});
