import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  bookableFarAhead,
  uniqueSuffix,
  type TestAgent,
} from './setup/fixtures';

/**
 * Pooled groups (kayak fleets) with a count and either fixed departure times or any start time: the owner changes them, a hold follows
 * their slot rules, and the customer search lists them with how many are still free at each start.
 */
describe('Pooled groups: count, slots and search', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let venueId: string;
  let facilityCode: string;
  let kayakCategoryId: string;

  async function createGroup(body: Record<string, unknown>) {
    const res = await ownerAgent.post('/resources/groups').send({ venueId, categoryId: kayakCategoryId, allocationMode: 'POOLED', sortOrder: 0, ...body });
    return res;
  }

  async function priceGroup(resourceGroupId: string, price: number, durationMinutes = 60) {
    for (const dayType of ['WEEKDAY', 'WEEKEND']) {
      const res = await ownerAgent.post('/resources/pricing-rules').send({ resourceGroupId, durationMinutes, dayType, pricingMode: 'PER_UNIT', price, currency: 'INR' });
      if (res.status !== 201) throw new Error(`Group pricing failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  async function searchFor(daysAhead: number) {
    const date = DateTime.now().setZone('Asia/Kolkata').plus({ days: daysAhead }).toISODate();
    const res = await request(app.getHttpServer()).get(`/search?facilityCode=${facilityCode}&date=${date}&timeWindow=ALL`);
    expect(res.status).toBe(200);
    return res.body as Array<{ resource: { id: string; name: string }; availableStartTimes: string[]; startPrices: string[]; pooled?: { totalUnits: number; slotMode: string; remaining: number[] } }>;
  }

  const hm = (iso: string) => DateTime.fromISO(iso).setZone('Asia/Kolkata').toFormat('HH:mm');

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    const fixture = await createOwnerFixture(app, adminAgent);
    ownerAgent = fixture.ownerAgent;
    const statesRes = await request(app.getHttpServer()).get('/states');
    const districtsRes = await request(app.getHttpServer()).get(`/districts?stateId=${statesRes.body[0]?.id}`);
    kayakCategoryId = (await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'KAYAKING' } })).id;
    const venueRes = await ownerAgent.post('/venues').send({
      name: `E2E Kayak Slots ${uniqueSuffix()}`,
      districtId: districtsRes.body[0]?.id,
      address: '3 Lake Road',
      lat: 10,
      lng: 76,
      timezone: 'Asia/Kolkata',
      defaultSlotGranularityMinutes: 30,
    });
    if (venueRes.status !== 201) throw new Error(`Venue creation failed: ${venueRes.status} ${JSON.stringify(venueRes.body)}`);
    venueId = venueRes.body.id as string;
    facilityCode = venueRes.body.facilityCode as string;
    await bookableFarAhead(venueId);
    const activate = await adminAgent.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' });
    if (activate.status !== 200) throw new Error(`Venue activation failed: ${activate.status}`);
  });

  afterAll(async () => {
    await app.close();
  });

  test('a fixed group needs its departure times, which must fit the booking grid', async () => {
    const noTimes = await createGroup({ name: 'No Times', totalUnits: 4, slotMode: 'FIXED', fixedStartTimes: [] });
    expect(noTimes.status).toBe(400);
    const badClock = await createGroup({ name: 'Bad Clock', totalUnits: 4, slotMode: 'FIXED', fixedStartTimes: ['25:00'] });
    expect(badClock.status).toBe(400);
    const offGrid = await createGroup({ name: 'Off Grid', totalUnits: 4, slotMode: 'FIXED', fixedStartTimes: ['08:10'] });
    expect(offGrid.status).toBe(400);
    expect(JSON.stringify(offGrid.body)).toMatch(/multiple of/);

    const ok = await createGroup({ name: 'Morning Paddle', totalUnits: 4, slotMode: 'FIXED', fixedStartTimes: ['10:00', '08:00', '08:00'] });
    expect(ok.status).toBe(201);
    expect(ok.body.slotMode).toBe('FIXED');
    expect(ok.body.fixedStartTimes).toEqual(['08:00', '10:00']); // sorted, no repeats
  });

  test('a hold on a fixed group is only accepted at one of its departures', async () => {
    const created = await createGroup({ name: 'Fixed Fleet', totalUnits: 5, slotMode: 'FIXED', fixedStartTimes: ['08:00', '10:00'] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await priceGroup(id, 400);
    const { agent: customer } = await createCustomerFixture(app);

    const off = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 1, startTime: futureStart(13, 9).toISOString(), durationMinutes: 60 });
    expect(off.status).toBe(400);
    expect(JSON.stringify(off.body)).toMatch(/fixed times: 8:00 AM, 10:00 AM/);
    const previewOff = await customer.get(`/bookings/group-availability?resourceGroupId=${id}&startTime=${encodeURIComponent(futureStart(13, 9).toISOString())}&durationMinutes=60&quantity=1`);
    expect(previewOff.body.available).toBe(false);

    const on = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 2, startTime: futureStart(13, 10).toISOString(), durationMinutes: 60 });
    expect(on.status).toBe(201);
    expect(Number(on.body.amount)).toBe(800);
  });

  test('a flexible group accepts any start on the grid inside its priced hours', async () => {
    const created = await createGroup({ name: 'Flexible Fleet', totalUnits: 5 });
    expect(created.status).toBe(201);
    expect(created.body.slotMode).toBe('FLEXIBLE');
    await priceGroup(created.body.id, 300);
    const { agent: customer } = await createCustomerFixture(app);
    const hold = await customer.post('/bookings/hold').send({ resourceGroupId: created.body.id, quantity: 1, startTime: futureStart(14, 11).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);
  });

  test('the count can change, but not below what is already booked at the busiest time ahead', async () => {
    const created = await createGroup({ name: 'Count Fleet', totalUnits: 6 });
    const id = created.body.id as string;
    await priceGroup(id, 300);
    const { agent: customer } = await createCustomerFixture(app);
    const start = futureStart(15, 12).toISOString();
    expect((await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 4, startTime: start, durationMinutes: 60 })).status).toBe(201);

    const tooLow = await ownerAgent.patch(`/resources/groups/${id}`).send({ totalUnits: 3 });
    expect(tooLow.status).toBe(400);
    expect(JSON.stringify(tooLow.body)).toMatch(/can't go below 4/);

    const up = await ownerAgent.patch(`/resources/groups/${id}`).send({ totalUnits: 9, name: 'Count Fleet II' });
    expect(up.status).toBe(200);
    expect(up.body.totalUnits).toBe(9);
    expect(up.body.name).toBe('Count Fleet II');

    const preview = await customer.get(`/bookings/group-availability?resourceGroupId=${id}&startTime=${encodeURIComponent(start)}&durationMinutes=60&quantity=1`);
    expect(preview.body.remaining).toBe(5);
  });

  test('switching a group to fixed needs times; a blocked group refuses holds', async () => {
    const created = await createGroup({ name: 'Switch Fleet', totalUnits: 3 });
    const id = created.body.id as string;
    await priceGroup(id, 250);
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FIXED' })).status).toBe(400);
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FIXED', fixedStartTimes: ['16:00'] })).status).toBe(200);
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FLEXIBLE' })).body.fixedStartTimes).toEqual([]);

    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ isBookable: false })).status).toBe(200);
    const { agent: customer } = await createCustomerFixture(app);
    const blocked = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 1, startTime: futureStart(16, 12).toISOString(), durationMinutes: 60 });
    expect(blocked.status).toBe(400);
  });

  test('another owner cannot change the group', async () => {
    const created = await createGroup({ name: 'Mine Fleet', totalUnits: 3 });
    const other = await createOwnerFixture(app, adminAgent);
    const res = await other.ownerAgent.patch(`/resources/groups/${created.body.id}`).send({ totalUnits: 1 });
    expect([403, 404]).toContain(res.status);
  });

  test('the search lists a group with how many are free at each start, and a hold takes units off', async () => {
    const created = await createGroup({ name: 'Search Fleet', totalUnits: 6, slotMode: 'FIXED', fixedStartTimes: ['08:00', '09:00', '15:00'] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await priceGroup(id, 350);

    const before = (await searchFor(20)).find((r) => r.resource.id === id);
    expect(before).toBeDefined();
    expect(before!.availableStartTimes.map(hm)).toEqual(['08:00', '09:00', '15:00']);
    expect(before!.pooled).toEqual({ totalUnits: 6, slotMode: 'FIXED', remaining: [6, 6, 6] });
    expect(before!.startPrices).toEqual(['350', '350', '350']); // per kayak

    const { agent: customer } = await createCustomerFixture(app);
    const hold = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 4, startTime: futureStart(20, 9).toISOString(), durationMinutes: 60 });
    expect(hold.status).toBe(201);

    // 09:00 has 2 left; 08:00 (ends at 09:00) and 15:00 are untouched.
    const after = (await searchFor(20)).find((r) => r.resource.id === id)!;
    expect(after.pooled!.remaining).toEqual([6, 2, 6]);

    // Everyone's last kayaks gone at 09:00: that start leaves the list.
    const rest = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 2, startTime: futureStart(20, 9).toISOString(), durationMinutes: 60 });
    expect(rest.status).toBe(201);
    const full = (await searchFor(20)).find((r) => r.resource.id === id)!;
    expect(full.availableStartTimes.map(hm)).toEqual(['08:00', '15:00']);
    expect(full.pooled!.remaining).toEqual([6, 6]);
  });

  test('a pooled group has up to three photos: listed for its owner, shown on its search card, and managed by its owner only', async () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const created = await createGroup({ name: 'Photo Fleet', totalUnits: 4 });
    const id = created.body.id as string;
    await priceGroup(id, 300);
    expect((await ownerAgent.get(`/resources/groups/${id}/photos`).expect(200)).body).toEqual([]);

    for (let i = 0; i < 3; i++) await ownerAgent.post(`/resources/groups/${id}/photos`).attach('file', PNG, `p${i}.png`).expect(201);
    const fourth = await ownerAgent.post(`/resources/groups/${id}/photos`).attach('file', PNG, 'p4.png').expect(400);
    expect(JSON.stringify(fourth.body)).toMatch(/3 photos at most/);

    const photos = (await ownerAgent.get(`/resources/groups/${id}/photos`).expect(200)).body as Array<{ id: string; url: string }>;
    expect(photos).toHaveLength(3);
    const card = (await searchFor(22)).find((r) => r.resource.id === id) as unknown as { resource: { photoUrls: string[] } };
    expect(card.resource.photoUrls).toEqual(photos.map((p) => p.url));
    const listed = (await ownerAgent.get(`/resources/groups`).query({ venueId }).expect(200)).body as Array<{ id: string; photos: unknown[] }>;
    expect(listed.find((g) => g.id === id)!.photos).toEqual(photos);

    const reversed = [...photos].reverse().map((p) => p.id);
    expect((await ownerAgent.put(`/resources/groups/${id}/photos/order`).send({ photoIds: reversed }).expect(200)).body.map((p: { id: string }) => p.id)).toEqual(reversed);
    const other = await createOwnerFixture(app, adminAgent);
    expect([403, 404]).toContain((await other.ownerAgent.post(`/resources/groups/${id}/photos`).attach('file', PNG, 'x.png')).status);
    const after = await ownerAgent.delete(`/resources/groups/${id}/photos/${reversed[0]}`).expect(200);
    expect(after.body).toHaveLength(2);
  });

  test('a group nobody has priced, or that is blocked, is not in the search', async () => {
    const unpriced = await createGroup({ name: 'Unpriced Search Fleet', totalUnits: 3 });
    const closed = await createGroup({ name: 'Closed Search Fleet', totalUnits: 3 });
    await priceGroup(closed.body.id, 200);
    await ownerAgent.patch(`/resources/groups/${closed.body.id}`).send({ isBookable: false });
    const listed = (await searchFor(21)).map((r) => r.resource.id);
    expect(listed).not.toContain(unpriced.body.id);
    expect(listed).not.toContain(closed.body.id);
  });
});
