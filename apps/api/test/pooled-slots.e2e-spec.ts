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

  const slot = (start: string, end: string, count: number, price: number | null = 400, advance: number | null = 200) => ({ start, end, count, price, advance });

  test('a fixed group needs slots that make sense: not empty, not overlapping, within the fleet, on the grid, priced within the platform rules', async () => {
    const mk = (slots: unknown[], total = 8) => createGroup({ name: 'Slot Rules', totalUnits: total, slotMode: 'FIXED', fixedSlots: slots });
    expect((await mk([])).status).toBe(400);
    expect((await mk([{ ...slot('25:00', '26:00', 3) }])).status).toBe(400); // not a clock time
    const overlap = await mk([slot('08:00', '10:00', 3), slot('09:00', '11:00', 3)]);
    expect(overlap.status).toBe(400);
    expect(JSON.stringify(overlap.body)).toMatch(/overlap/i);
    const tooMany = await mk([slot('08:00', '09:00', 9)]);
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(tooMany.body)).toMatch(/more than the 8/);
    const offGrid = await mk([slot('08:10', '09:10', 3)]);
    expect(offGrid.status).toBe(400);
    expect(JSON.stringify(offGrid.body)).toMatch(/multiple of/);
    const backwards = await mk([slot('10:00', '09:00', 3)]);
    expect(backwards.status).toBe(400);
    const lowAdvance = await mk([slot('08:00', '09:00', 3, 400, 10)]);
    expect(lowAdvance.status).toBe(400);
    expect(JSON.stringify(lowAdvance.body)).toMatch(/at least \d+%/);
    const advanceAbovePrice = await mk([slot('08:00', '09:00', 3, 400, 500)]);
    expect(advanceAbovePrice.status).toBe(400);

    const ok = await mk([slot('10:00', '11:00', 8, 550, 300), slot('08:00', '09:00', 5, 400, 200)]);
    expect(ok.status).toBe(201);
    expect(ok.body.slotMode).toBe('FIXED');
    expect(ok.body.fixedSlots.map((s: { start: string }) => s.start)).toEqual(['08:00', '10:00']); // kept in clock order
  });

  test('a hold on a fixed group follows its slot: its start and length, its own count, its own price', async () => {
    const created = await createGroup({ name: 'Fixed Fleet', totalUnits: 8, slotMode: 'FIXED', fixedSlots: [slot('08:00', '09:00', 5, 400, 200), slot('10:00', '11:00', 8, 550, 300)] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const { agent: customer } = await createCustomerFixture(app);
    const at = (hour: number) => futureStart(13, hour).toISOString();

    // Not a slot start, and the wrong length for a slot.
    const off = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 1, startTime: at(9), durationMinutes: 60 });
    expect(off.status).toBe(400);
    expect(JSON.stringify(off.body)).toMatch(/fixed times: 8:00 AM – 9:00 AM, 10:00 AM – 11:00 AM/);
    const wrongLength = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 1, startTime: at(8), durationMinutes: 120 });
    expect(wrongLength.status).toBe(400);
    const previewOff = await customer.get(`/bookings/group-availability?resourceGroupId=${id}&startTime=${encodeURIComponent(at(9))}&durationMinutes=60&quantity=1`);
    expect(previewOff.body.available).toBe(false);

    // The 8-9 slot offers 5 even though the fleet is 8; 3 are taken, so 2 remain and 3 more are refused.
    const first = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 3, startTime: at(8), durationMinutes: 60 });
    expect(first.status).toBe(201);
    expect(Number(first.body.amount)).toBe(1200); // 3 x 400, the slot's own price
    const preview = await customer.get(`/bookings/group-availability?resourceGroupId=${id}&startTime=${encodeURIComponent(at(8))}&durationMinutes=60&quantity=1`);
    expect(preview.body.remaining).toBe(2);
    expect(Number(preview.body.price.unitPrice)).toBe(400);
    expect((await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 3, startTime: at(8), durationMinutes: 60 })).status).toBe(409);
    // The other slot has its own 8, untouched, at its own price.
    const second = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 6, startTime: at(10), durationMinutes: 60 });
    expect(second.status).toBe(201);
    expect(Number(second.body.amount)).toBe(3300); // 6 x 550
    // More than a slot offers is refused outright.
    expect((await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 6, startTime: at(8), durationMinutes: 60 })).status).toBe(400);
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

  test('switching a group to fixed needs slots; the count cannot go below a slot; a blocked group refuses holds', async () => {
    const created = await createGroup({ name: 'Switch Fleet', totalUnits: 3 });
    const id = created.body.id as string;
    await priceGroup(id, 250);
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FIXED' })).status).toBe(400);
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FIXED', fixedSlots: [slot('16:00', '17:00', 3)] })).status).toBe(200);
    const low = await ownerAgent.patch(`/resources/groups/${id}`).send({ totalUnits: 2 });
    expect(low.status).toBe(400); // a slot offers 3
    expect((await ownerAgent.patch(`/resources/groups/${id}`).send({ slotMode: 'FLEXIBLE' })).body.fixedSlots).toEqual([]);

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

  test('the search lists fixed slots as time ranges with their own count and price, and a hold takes items off', async () => {
    const created = await createGroup({ name: 'Search Fleet', totalUnits: 8, slotMode: 'FIXED', fixedSlots: [slot('08:00', '09:00', 5, 400, 200), slot('10:00', '12:00', 8, 700, 350), slot('15:00', '16:00', 4, 300, 150)] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const before = (await searchFor(20)).find((r) => r.resource.id === id) as unknown as {
      availableStartTimes: string[];
      startPrices: string[];
      pooled: { totalUnits: number; slotMode: string; remaining: number[]; slots: Array<{ endTime: string; durationMinutes: number; capacity: number }> };
    };
    expect(before).toBeDefined();
    expect(before.availableStartTimes.map(hm)).toEqual(['08:00', '10:00', '15:00']);
    expect(before.pooled.remaining).toEqual([5, 8, 4]); // each slot's own count
    expect(before.pooled.slots.map((s) => [hm(s.endTime), s.durationMinutes, s.capacity])).toEqual([['09:00', 60, 5], ['12:00', 120, 8], ['16:00', 60, 4]]);
    expect(before.startPrices).toEqual(['400', '700', '300']); // per item, typed on the slot

    const { agent: customer } = await createCustomerFixture(app);
    const hold = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 3, startTime: futureStart(20, 10).toISOString(), durationMinutes: 120 });
    expect(hold.status).toBe(201);
    expect(Number(hold.body.amount)).toBe(2100);
    const after = (await searchFor(20)).find((r) => r.resource.id === id)!;
    expect(after.pooled!.remaining).toEqual([5, 5, 4]);

    // Every item of a slot gone: that slot leaves the list.
    const rest = await customer.post('/bookings/hold').send({ resourceGroupId: id, quantity: 4, startTime: futureStart(20, 15).toISOString(), durationMinutes: 60 });
    expect(rest.status).toBe(201);
    const full = (await searchFor(20)).find((r) => r.resource.id === id)!;
    expect(full.availableStartTimes.map(hm)).toEqual(['08:00', '10:00']);
  });

  test('a slot with no price yet is saved but not shown to customers', async () => {
    const created = await createGroup({ name: 'Unpriced Slot Fleet', totalUnits: 4, slotMode: 'FIXED', fixedSlots: [slot('08:00', '09:00', 4, null, null), slot('10:00', '11:00', 4, 300, 150)] });
    expect(created.status).toBe(201);
    const card = (await searchFor(21)).find((r) => r.resource.id === created.body.id)!;
    expect(card.availableStartTimes.map(hm)).toEqual(['10:00']);
    const { agent: customer } = await createCustomerFixture(app);
    expect((await customer.post('/bookings/hold').send({ resourceGroupId: created.body.id, quantity: 1, startTime: futureStart(21, 8).toISOString(), durationMinutes: 60 })).status).toBe(400);
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
