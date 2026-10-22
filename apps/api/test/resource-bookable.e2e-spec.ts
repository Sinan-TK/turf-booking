import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  type TestAgent,
} from './setup/fixtures';

describe('blocking a unit or a whole facility from new bookings', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let other: TestAgent;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let footballId: string;

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    other = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, owner, admin);
    footballId = (await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'FOOTBALL_TURF' } })).id;
  });
  afterAll(async () => app.close());

  const walkIn = (resourceId: string) =>
    owner.post('/owner/bookings').send({
      resourceId,
      durationMinutes: 60,
      customerWhatsappNumber: '+919900001111',
      startTime: futureStart(3, 10).toISOString(),
    });

  it('blocks one unit independently of its siblings, and reopens it', async () => {
    const res = await owner.patch(`/resources/${venue.halfAId}`).send({ isBookable: false }).expect(200);
    expect(res.body.isBookable).toBe(false);

    const list = await owner.get(`/resources?venueId=${venue.venueId}`).expect(200);
    const byId = new Map(list.body.map((r: { id: string; isBookable: boolean }) => [r.id, r.isBookable]));
    expect(byId.get(venue.halfAId)).toBe(false);
    expect(byId.get(venue.halfBId)).toBe(true);

    expect((await walkIn(venue.halfAId)).status).toBe(404);

    await owner.patch(`/resources/${venue.halfAId}`).send({ isBookable: true }).expect(200);
    expect((await walkIn(venue.halfAId)).status).toBe(201);
  });

  it("another organization cannot block this venue's units", async () => {
    await other.patch(`/resources/${venue.halfBId}`).send({ isBookable: false }).expect(403);
    await other
      .patch('/resources/facility-bookable')
      .send({ venueId: venue.venueId, categoryId: footballId, isBookable: false })
      .expect(403);
  });

  it('blocks and reopens every unit of a facility at once', async () => {
    const off = await owner
      .patch('/resources/facility-bookable')
      .send({ venueId: venue.venueId, categoryId: footballId, isBookable: false })
      .expect(200);
    expect(off.body.updated).toBe(3);
    const list = await owner.get(`/resources?venueId=${venue.venueId}`).expect(200);
    expect(list.body.every((r: { isBookable: boolean }) => r.isBookable === false)).toBe(true);

    await owner
      .patch('/resources/facility-bookable')
      .send({ venueId: venue.venueId, categoryId: footballId, isBookable: true })
      .expect(200);
  });

  it('rejects a missing unit and a malformed body', async () => {
    await owner.patch('/resources/00000000-0000-4000-8000-000000000000').send({ isBookable: false }).expect(404);
    await owner.patch(`/resources/${venue.halfAId}`).send({ isBookable: 'no' }).expect(400);
    await owner.patch('/resources/not-a-uuid').send({ isBookable: false }).expect(400);
  });

  describe('the unit type only exists for facilities with preset types', () => {
    it('stores no type for a facility without presets (even if one is sent), and requires one where types are preset', async () => {
      const badminton = await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'BADMINTON' } });
      const created = await owner
        .post('/resources')
        .send({ venueId: venue.venueId, categoryId: badminton.id, name: 'Court 1' })
        .expect(201);
      expect(created.body.groundType).toBe('');
      const ignored = await owner
        .post('/resources')
        .send({ venueId: venue.venueId, categoryId: badminton.id, name: 'Court 1b', groundType: 'Whatever' })
        .expect(201);
      expect(ignored.body.groundType).toBe(''); // free text is never stored

      // Football Turf has preset types (5S / 7S), so one must still be chosen.
      await owner
        .post('/resources')
        .send({ venueId: venue.venueId, categoryId: footballId, name: 'No type turf' })
        .expect(400);
      await owner
        .post('/resources')
        .send({ venueId: venue.venueId, categoryId: footballId, name: 'Bad type turf', groundType: '' })
        .expect(400);
    });

    it('a booking on a typeless unit still records what was booked', async () => {
      const badminton = await prisma.venueCategory.findUniqueOrThrow({ where: { slug: 'BADMINTON' } });
      const unit = await owner
        .post('/resources')
        .send({ venueId: venue.venueId, categoryId: badminton.id, name: 'Court 2' })
        .expect(201);
      await owner
        .post('/resources/pricing-rules')
        .send({ resourceId: unit.body.id, durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], price: 300 })
        .expect(201);
      const booked = await owner
        .post('/owner/bookings')
        .send({
          resourceId: unit.body.id,
          durationMinutes: 60,
          customerWhatsappNumber: '+919800004444',
          startTime: futureStart(4, 11).toISOString(),
        })
        .expect(201);
      expect(booked.body.groundType).toBe('Court 2');
    });
  });
});
