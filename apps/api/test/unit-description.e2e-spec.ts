import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma } from './setup/fixtures';

/** The description belongs to each unit: the owner writes it per unit, and the search / venue page carries the unit's own text. */
describe('Unit description', () => {
  let app: INestApplication;
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  let ownerAgent: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];
  let strangerAgent: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];
  let facilityCode: string;

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    ownerAgent = (await createOwnerFixture(app, admin)).ownerAgent;
    strangerAgent = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, ownerAgent, admin);
    facilityCode = (await prisma.venue.findUniqueOrThrow({ where: { id: venue.venueId } })).facilityCode;
  });
  afterAll(async () => {
    await app.close();
  });

  const search = async () => {
    const date = DateTime.now().setZone('Asia/Kolkata').plus({ days: 2 }).toISODate();
    const res = await request(app.getHttpServer()).get('/search').query({ facilityCode, date, timeWindow: 'ALL' });
    expect(res.status).toBe(200);
    return res.body as Array<{ resource: { id: string; description: string | null } }>;
  };

  test("an owner writes a unit's description, and customers' search carries that unit's own text", async () => {
    const res = await ownerAgent.patch(`/resources/${venue.halfAId}/description`).send({ description: '  Floodlit 5-a-side turf. Bring your own boots.  ' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Floodlit 5-a-side turf. Bring your own boots.');

    const results = await search();
    const a = results.find((r) => r.resource.id === venue.halfAId);
    const b = results.find((r) => r.resource.id === venue.halfBId);
    expect(a?.resource.description).toBe('Floodlit 5-a-side turf. Bring your own boots.');
    expect(b?.resource.description ?? null).not.toBe('Floodlit 5-a-side turf. Bring your own boots.'); // another unit does not share it
  });

  test('an empty description removes it', async () => {
    await ownerAgent.patch(`/resources/${venue.halfBId}/description`).send({ description: 'Next to the car park.' });
    const res = await ownerAgent.patch(`/resources/${venue.halfBId}/description`).send({ description: '   ' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBeNull();
    expect((await prisma.resource.findUniqueOrThrow({ where: { id: venue.halfBId } })).description).toBeNull();
  });

  test('more than 2000 characters is refused', async () => {
    const res = await ownerAgent.patch(`/resources/${venue.halfAId}/description`).send({ description: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  test("another organization's owner cannot change it", async () => {
    const res = await strangerAgent.patch(`/resources/${venue.halfAId}/description`).send({ description: 'Mine now' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.resource.findUniqueOrThrow({ where: { id: venue.halfAId } })).description).not.toBe('Mine now');
  });

  test('a pooled item has its own description too', async () => {
    const category = await prisma.venueCategory.findFirstOrThrow({ where: { slug: 'FOOTBALL_TURF' } });
    const group = await prisma.resourceGroup.create({
      data: { venueId: venue.venueId, categoryId: category.id, name: 'Kayaks', allocationMode: 'POOLED', totalUnits: 4 },
    });
    const res = await ownerAgent.patch(`/resources/groups/${group.id}`).send({ description: 'Single kayaks, life jackets included.' });
    expect(res.status).toBe(200);
    expect((await prisma.resourceGroup.findUniqueOrThrow({ where: { id: group.id } })).description).toBe('Single kayaks, life jackets included.');
    const cleared = await ownerAgent.patch(`/resources/groups/${group.id}`).send({ description: '' });
    expect(cleared.status).toBe(200);
    expect((await prisma.resourceGroup.findUniqueOrThrow({ where: { id: group.id } })).description).toBeNull();
  });
});
