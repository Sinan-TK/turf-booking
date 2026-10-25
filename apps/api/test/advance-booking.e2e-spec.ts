import type { INestApplication } from '@nestjs/common';
import { DateTime } from 'luxon';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

const ZONE = 'Asia/Kolkata';
const day = (offset: number) => DateTime.now().setZone(ZONE).startOf('day').plus({ days: offset });

/** "Book up to n days ahead": today and the next n - 1 days, set per venue by its owner (default 7, at most 14). */
describe('how far ahead a venue can be booked', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let venueId: string;
  let facilityCode: string;
  let unitId: string;

  const setDays = (advanceBookingDays: unknown) => owner.patch(`/venues/${venueId}`).send({ advanceBookingDays });
  const search = (offset: number) =>
    request(app.getHttpServer()).get('/search').query({ date: day(offset).toISODate()!, timeWindow: 'ALL', durationMinutes: 60, facilityCode });
  const hold = async (offset: number, hour: number) => {
    const { agent } = await createCustomerFixture(app);
    return agent.post('/bookings/hold').send({ resourceId: unitId, startTime: day(offset).set({ hour }).toUTC().toISO(), durationMinutes: 60 });
  };

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    const venue = await createVenueFixture(app, owner, admin);
    venueId = venue.venueId;
    unitId = venue.fullGroundId;
    facilityCode = (await prisma.venue.findUniqueOrThrow({ where: { id: venueId } })).facilityCode;
  });
  afterAll(async () => app.close());

  it('is 7 days for a new venue, and the owner can set 1 to 14, nothing else', async () => {
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: venueId } })).advanceBookingDays).toBe(7);
    for (const bad of [0, 15, 30, 3.5, -1, '5', null]) expect((await setDays(bad)).status).toBe(400);
    expect((await setDays(14)).status).toBe(200);
    expect((await setDays(1)).status).toBe(200);
    const saved = await setDays(10);
    expect(saved.status).toBe(200);
    expect(saved.body.advanceBookingDays).toBe(10);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: venueId } })).advanceBookingDays).toBe(10);
  });

  it('search shows slots through the last allowed day and none after it, and says how many days to offer', async () => {
    await setDays(3).expect(200);
    for (const offset of [1, 2]) expect((await search(offset).expect(200)).body.length).toBeGreaterThan(0);
    const beyond = await search(3).expect(200);
    expect(beyond.body).toEqual([]); // day four is past "3 days"
    expect(beyond.headers['x-advance-days']).toBe('3');
    await setDays(14).expect(200);
    expect((await search(13).expect(200)).body.length).toBeGreaterThan(0);
    expect((await search(14).expect(200)).body).toEqual([]);
    expect((await search(13)).headers['x-advance-days']).toBe('14');
  });

  it('a hold is refused past the limit, and allowed all day long on the last day', async () => {
    await setDays(3).expect(200);
    const late = await hold(3, 10);
    expect(late.status).toBe(400);
    expect(JSON.stringify(late.body)).toMatch(/up to 3 days ahead/);
    expect((await hold(2, 22)).status).toBe(201); // 10 PM on the last day still counts
    await setDays(14).expect(200);
    expect((await hold(13, 9)).status).toBe(201);
    expect((await hold(14, 9)).status).toBe(400);
  });

  it('a one-day venue is bookable for today only', async () => {
    await setDays(1).expect(200);
    const tomorrow = await hold(1, 10);
    expect(tomorrow.status).toBe(400);
    expect(JSON.stringify(tomorrow.body)).toMatch(/only be booked for today/);
  });

  it('the owner can still log a walk-in far ahead', async () => {
    await setDays(1).expect(200);
    const res = await owner.post('/owner/bookings').send({
      resourceId: unitId,
      durationMinutes: 60,
      customerWhatsappNumber: '9876500123',
      startTime: day(30).set({ hour: 10 }).toUTC().toISO(),
    });
    expect(res.status).toBe(201);
  });
});
