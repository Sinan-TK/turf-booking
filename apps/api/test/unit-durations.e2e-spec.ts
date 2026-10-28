import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { DateTime } from 'luxon';
import { unitDurationProblem, unitDurations } from '@venue/shared';
import { priceBooking, type PricingRuleLike } from '../src/pricing/pricing-rules';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

const TZ = 'Asia/Kolkata';
const nextDay = (weekday: number): DateTime => {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf('day');
  while (d.weekday !== weekday) d = d.plus({ days: 1 });
  return d;
};
const at = (day: DateTime, hour: number, minute = 0) => day.set({ hour, minute }).toJSDate();

describe('unitDurationProblem / unitDurations (shared rules)', () => {
  it('accepts a longest booking that is a whole number of shortest bookings', () => {
    expect(unitDurationProblem({ minMinutes: 60, maxMinutes: 180 })).toBeNull();
    expect(unitDurationProblem({ minMinutes: 60, maxMinutes: 60 })).toBeNull();
    expect(unitDurationProblem({ minMinutes: 45, maxMinutes: 90, slotIntervalMin: 15 })).toBeNull();
    expect(unitDurations(30, 120)).toEqual([30, 60, 90, 120]);
    expect(unitDurations(60, 60)).toEqual([60]);
  });

  it('rejects a longest booking that is not a multiple, or shorter than the shortest', () => {
    expect(unitDurationProblem({ minMinutes: 60, maxMinutes: 100 })).toMatch(/multiple of the minimum/);
    expect(unitDurationProblem({ minMinutes: 60, maxMinutes: 30 })).toMatch(/can't be shorter/);
    expect(unitDurations(60, 100)).toEqual([]);
  });

  it('rejects non-positive or fractional numbers, more than a day, and a shortest booking off the start grid', () => {
    expect(unitDurationProblem({ minMinutes: 0, maxMinutes: 60 })).toMatch(/minimum/);
    expect(unitDurationProblem({ minMinutes: 30.5, maxMinutes: 61 })).toMatch(/minimum/);
    expect(unitDurationProblem({ minMinutes: 60, maxMinutes: 1500 })).toMatch(/one day/);
    expect(unitDurationProblem({ minMinutes: 90, maxMinutes: 180, slotIntervalMin: 60 })).toMatch(/multiple of 60/);
  });
});

describe('priceBooking (pure)', () => {
  const rule = (
    weekdays: number[],
    startWindow: string | null,
    endWindow: string | null,
    normalPrice: number,
    extra: { offerPrice?: number; bookingPrice?: number } = {},
  ) => ({
    weekdays,
    startWindow,
    endWindow,
    isActive: true,
    effectiveFrom: new Date(0),
    createdAt: new Date(0),
    normalPrice,
    offerPrice: extra.offerPrice ?? null,
    bookingPrice: extra.bookingPrice ?? extra.offerPrice ?? normalPrice,
    currency: 'INR',
  });
  const monday = DateTime.fromISO('2030-01-07T00:00:00', { zone: TZ }); // a Monday

  it('is the block price for one block, and n times it for n blocks', () => {
    const rules = [rule([1], null, null, 800)];
    expect(priceBooking(rules, at(monday, 10), 60, 60, TZ)?.amount).toBe(800);
    expect(priceBooking(rules, at(monday, 10), 180, 60, TZ)?.amount).toBe(2400);
    expect(priceBooking(rules, at(monday, 10), 90, 30, TZ)?.amount).toBe(2400);
  });

  it('prices each block at the time it starts, so a booking can run from off-peak into peak hours', () => {
    const rules = [rule([1], '06:00', '18:00', 800), rule([1], '18:00', '24:00', 1500)];
    const price = priceBooking(rules, at(monday, 17), 180, 60, TZ)!;
    expect(price.amount).toBe(800 + 1500 + 1500);
    expect(price.blocks.map((b) => b.amount)).toEqual([800, 1500, 1500]);
  });

  it('uses the next day\'s price for a block after local midnight', () => {
    const rules = [rule([1], null, null, 800), rule([2], null, null, 1000)];
    expect(priceBooking(rules, at(monday, 23), 120, 60, TZ)?.amount).toBe(800 + 1000);
  });

  it('sums offers, keeps the normal total for the strike-through, and sums the online advances', () => {
    const rules = [rule([1], null, null, 800, { offerPrice: 600, bookingPrice: 300 })];
    const price = priceBooking(rules, at(monday, 10), 180, 60, TZ)!;
    expect(price.amount).toBe(1800);
    expect(price.normalAmount).toBe(2400);
    expect(price.advance).toBe(900);
    expect(price.currency).toBe('INR');
  });

  it('counts a block without an offer at its normal price in the normal total', () => {
    const rules = [rule([1], '06:00', '12:00', 800, { offerPrice: 600 }), rule([1], '12:00', '24:00', 900)];
    const price = priceBooking(rules, at(monday, 11), 120, 60, TZ)!;
    expect(price.amount).toBe(600 + 900);
    expect(price.normalAmount).toBe(800 + 900);
  });

  it('is null when any block has no price, or the length is not a whole number of blocks', () => {
    const rules = [rule([1], '06:00', '12:00', 800)];
    expect(priceBooking(rules, at(monday, 11), 120, 60, TZ)).toBeNull(); // the 12:00 block is unpriced
    expect(priceBooking(rules, at(monday, 10), 90, 60, TZ)).toBeNull();
    expect(priceBooking(rules, at(monday, 10), 0, 60, TZ)).toBeNull();
    expect(priceBooking(rules, at(monday, 10), 60, 0, TZ)).toBeNull();
  });

  it('ignores blocked prices', () => {
    const blocked = { ...rule([1], null, null, 100), isActive: false };
    expect(priceBooking([blocked, rule([1], null, null, 800)] as PricingRuleLike[] as never, at(monday, 10), 120, 60, TZ)?.amount).toBe(1600);
  });
});

describe('a unit\'s shortest and longest booking', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let owner: TestAgent;
  let other: TestAgent;
  let customer: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let facilityCode: string;
  let categoryId: string;

  const hold = (resourceId: string, start: Date, durationMinutes: number) =>
    customer.post('/bookings/hold').send({ resourceId, startTime: start.toISOString(), durationMinutes });
  const search = async (day: DateTime, durationMinutes?: number) => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ facilityCode, date: day.toFormat('yyyy-MM-dd'), timeWindow: 'ALL', ...(durationMinutes ? { durationMinutes } : {}) })
      .expect(200);
    return res.body as Array<{
      resource: { id: string };
      policy: { minDurationMin: number; maxDurationMin: number; durationIncrementMin: number; durations: number[] };
      availableStartTimes: string[];
      durationMinutes: number;
      price: { amount: string; bookingAmount: string } | null;
      startPrices: Array<string | null>;
    }>;
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    ({ agent: customer } = await createCustomerFixture(app));
    venue = await createVenueFixture(app, owner, admin); // football units, 800 per 60-minute block, every day
    facilityCode = (await owner.get(`/venues/${venue.venueId}`).expect(200)).body.facilityCode;
    categoryId = (await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'FOOTBALL_TURF' } })).id;
  });
  afterAll(async () => app.close());

  it('a new unit starts from its facility\'s own values, or from the values the owner gives', async () => {
    const unit = await prisma.resource.findUniqueOrThrow({ where: { id: venue.halfAId } });
    expect(unit.minDurationMinutes).toBe(60);
    expect(unit.maxDurationMinutes).toBe(180);

    const own = await owner
      .post('/resources')
      .send({ venueId: venue.venueId, categoryId, name: 'Long pitch', groundType: '5S', minDurationMinutes: 120, maxDurationMinutes: 360 })
      .expect(201);
    expect(own.body).toMatchObject({ minDurationMinutes: 120, maxDurationMinutes: 360 });
  });

  it('rejects a longest booking that is not a multiple of the shortest, or a shortest off the start grid', async () => {
    const base = { venueId: venue.venueId, categoryId, name: 'Bad pitch', groundType: '5S' };
    const notMultiple = await owner.post('/resources').send({ ...base, minDurationMinutes: 60, maxDurationMinutes: 100 }).expect(400);
    expect(notMultiple.body.message).toMatch(/multiple of the minimum time \(60 min\)/);
    await owner.post('/resources').send({ ...base, minDurationMinutes: 60, maxDurationMinutes: 30 }).expect(400);
    const offGrid = await owner.post('/resources').send({ ...base, minDurationMinutes: 90, maxDurationMinutes: 180 }).expect(400);
    expect(offGrid.body.message).toMatch(/multiple of 60 minutes/);
  });

  it('changes a unit\'s lengths, checks the same rules, and only for the unit\'s own organization', async () => {
    const unit = await owner
      .post('/resources')
      .send({ venueId: venue.venueId, categoryId, name: 'Editable pitch', groundType: '5S' })
      .expect(201);
    const id = unit.body.id as string;
    const ok = await owner.patch(`/resources/${id}/durations`).send({ minDurationMinutes: 60, maxDurationMinutes: 240 }).expect(200);
    expect(ok.body).toMatchObject({ minDurationMinutes: 60, maxDurationMinutes: 240 });
    await owner.patch(`/resources/${id}/durations`).send({ minDurationMinutes: 60, maxDurationMinutes: 100 }).expect(400);
    await owner.patch(`/resources/${id}/durations`).send({ minDurationMinutes: 0, maxDurationMinutes: 60 }).expect(400);
    await other.patch(`/resources/${id}/durations`).send({ minDurationMinutes: 60, maxDurationMinutes: 120 }).expect(403);
    await customer.patch(`/resources/${id}/durations`).send({ minDurationMinutes: 60, maxDurationMinutes: 120 }).expect(403);
    expect((await prisma.resource.findUniqueOrThrow({ where: { id } })).maxDurationMinutes).toBe(240);
  });

  it('a booking of n blocks costs n block prices, is capped at the longest, and keeps its price breakdown', async () => {
    const day = nextDay(2);
    const three = await hold(venue.halfAId, at(day, 10), 180).expect(201);
    expect(Number(three.body.amount)).toBe(2400);
    expect(three.body.durationMinutes).toBe(180);

    const snapshot = (await prisma.slotHold.findFirstOrThrow({ where: { booking: { id: three.body.id } } })).priceSnapshot as {
      amount: string;
      blockMinutes: number;
      blocks: Array<{ amount: string }>;
    };
    expect(snapshot.amount).toBe('2400');
    expect(snapshot.blockMinutes).toBe(60);
    expect(snapshot.blocks.map((b) => b.amount)).toEqual(['800', '800', '800']);

    const tooLong = await hold(venue.halfBId, at(day, 10), 240).expect(400); // longest is 180
    expect(tooLong.body.message).toMatch(/allowed: 60, 120, 180/);
    await hold(venue.halfBId, at(day, 10), 90).expect(400); // not a whole number of 60-minute blocks
  });

  it('search shows each unit at its own shortest booking when no length is asked for', async () => {
    const day = nextDay(3);
    const rows = await search(day);
    const a = rows.find((r) => r.resource.id === venue.halfAId)!;
    expect(a.durationMinutes).toBe(60);
    expect(a.policy).toMatchObject({ minDurationMin: 60, maxDurationMin: 180, durationIncrementMin: 60, durations: [60, 120, 180] });
    expect(a.price?.amount).toBe('800');

    // A unit booked in 2-hour blocks: its own price per block, and a policy of 120/240.
    const unit = await owner
      .post('/resources')
      .send({ venueId: venue.venueId, categoryId, name: 'Two-hour pitch', groundType: '5S', minDurationMinutes: 120, maxDurationMinutes: 240 })
      .expect(201);
    await owner.post('/resources/pricing-rules').send({ resourceId: unit.body.id, dayType: 'WEEKDAY', price: 1500 }).expect(201);
    await owner.post('/resources/pricing-rules').send({ resourceId: unit.body.id, dayType: 'WEEKEND', price: 1500 }).expect(201);

    const after = await search(day);
    const b = after.find((r) => r.resource.id === unit.body.id)!;
    expect(b.policy).toMatchObject({ minDurationMin: 120, maxDurationMin: 240, durationIncrementMin: 120, durations: [120, 240] });
    expect(b.price?.amount).toBe('1500');
    expect(b.price?.bookingAmount).toBe('1500');
    expect(after.find((r) => r.resource.id === venue.halfAId)!.price?.amount).toBe('800');

    // Asking for 2 hours: the 60-minute unit shows two blocks (1600), the 120-minute unit one (1500).
    const two = await search(day, 120);
    expect(two.find((r) => r.resource.id === venue.halfAId)!.price?.amount).toBe('1600');
    expect(two.find((r) => r.resource.id === unit.body.id)!.price?.amount).toBe('1500');

    expect(two.find((r) => r.resource.id === venue.halfAId)!.durationMinutes).toBe(120);

    // Asking for 1 hour: the 2-hour unit does not offer it, so it is shown at its own shortest (2 hours) and says so.
    const one = await search(day, 60);
    expect(one.find((r) => r.resource.id === unit.body.id)).toMatchObject({ durationMinutes: 120, price: { amount: '1500' } });
    expect(one.find((r) => r.resource.id === venue.halfAId)).toMatchObject({ durationMinutes: 60, price: { amount: '800' } });

    const held = await hold(unit.body.id, at(day, 10), 240).expect(201);
    expect(Number(held.body.amount)).toBe(3000);
    await hold(unit.body.id, at(day, 16), 60).expect(400);
  });

  it('the online advance of a longer booking is the sum of its blocks\' advances', async () => {
    const unit = await owner
      .post('/resources')
      .send({ venueId: venue.venueId, categoryId, name: 'Advance pitch', groundType: '5S' })
      .expect(201);
    // 1000 per hour, 600 of it paid online (above the facility's minimum advance share).
    await owner.post('/resources/pricing-rules').send({ resourceId: unit.body.id, days: [1, 2, 3, 4, 5, 6, 7], price: 1000, bookingPrice: 600 }).expect(201);
    const rows = await search(nextDay(4), 120);
    const row = rows.find((r) => r.resource.id === unit.body.id)!;
    expect(row.price?.amount).toBe('2000');
    expect(row.price?.bookingAmount).toBe('1200');
  });
  it('the migration gives existing units their lengths from their old prices and switches off the longer ones', async () => {
    const sql = readFileSync(
      join(__dirname, '../../../packages/database/prisma/migrations/20261031000000_unit_min_max_duration/migration.sql'),
      'utf8',
    );
    // The column changes already exist in this database; run the data statements only.
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement && !/^ALTER TABLE/i.test(statement));
    expect(statements).toHaveLength(4);

    const priced = await prisma.resource.create({ data: { venueId: venue.venueId, categoryId, name: 'Old priced', groundType: '5S' } });
    const unpriced = await prisma.resource.create({ data: { venueId: venue.venueId, categoryId, name: 'Old unpriced', groundType: '5S' } });
    for (const [durationMinutes, price] of [[90, 1000], [30, 400], [60, 800]] as const) {
      await prisma.pricingRule.create({
        data: { resourceId: priced.id, durationMinutes, weekdays: [1, 2, 3, 4, 5, 6, 7], normalPrice: price, bookingPrice: price },
      });
    }

    class Rollback extends Error {}
    let seen: { priced: { min: number; max: number }; unpriced: { min: number; max: number }; active: number[]; inactive: number[] } | undefined;
    await prisma
      .$transaction(async (tx) => {
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        const [p, u] = await Promise.all([
          tx.resource.findUniqueOrThrow({ where: { id: priced.id } }),
          tx.resource.findUniqueOrThrow({ where: { id: unpriced.id } }),
        ]);
        const rules = await tx.pricingRule.findMany({ where: { resourceId: priced.id } });
        seen = {
          priced: { min: p.minDurationMinutes, max: p.maxDurationMinutes },
          unpriced: { min: u.minDurationMinutes, max: u.maxDurationMinutes },
          active: rules.filter((r) => r.isActive).map((r) => r.durationMinutes),
          inactive: rules.filter((r) => !r.isActive).map((r) => r.durationMinutes).sort((a, b) => a - b),
        };
        throw new Rollback();
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });

    // Shortest priced length is 30; the football policy allowed up to 180, so the longest is 6 blocks of 30.
    expect(seen?.priced).toEqual({ min: 30, max: 180 });
    expect(seen?.active).toEqual([30]);
    expect(seen?.inactive).toEqual([60, 90]);
    // No prices: the facility's own values.
    expect(seen?.unpriced).toEqual({ min: 60, max: 180 });
  });
});
