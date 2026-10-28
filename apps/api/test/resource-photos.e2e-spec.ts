import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';

// The smallest valid files of each accepted type (their first bytes are what the API checks).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(14)]);

/** Owners give each unit up to three photos; customers see them (main one first) on the search cards. */
describe('unit photos', () => {
  let app: INestApplication;
  type Agent = Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];
  let owner: Agent;
  let otherOwner: Agent;
  let unitId: string;
  const TEXT = `Photos ${uniqueSuffix()}`;
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const upload = (agent: Agent, bytes: Buffer, name = 'photo.png') =>
    agent.post(`/resources/${unitId}/photos`).attach('file', bytes, name);

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    otherOwner = (await createOwnerFixture(app, admin)).ownerAgent;
    const venue = await createVenueFixture(app, owner, admin);
    unitId = venue.fullGroundId;
    await prisma.venue.update({ where: { id: venue.venueId }, data: { name: TEXT } });
  });
  afterAll(async () => app.close());

  it('a unit starts with no photos, and search shows an empty list for it', async () => {
    expect((await owner.get(`/resources/${unitId}/photos`).expect(200)).body).toEqual([]);
    const search = await request(app.getHttpServer())
      .get('/search')
      .query({ date, timeWindow: 'ALL', durationMinutes: 60, lat: 10, lng: 76, radiusKm: 5, q: TEXT })
      .expect(200);
    const card = search.body.find((r: { resource: { id: string } }) => r.resource.id === unitId);
    expect(card.resource.photoUrls).toEqual([]);
  });

  it('JPEG, PNG and WebP are accepted, up to three; a fourth is refused', async () => {
    await upload(owner, PNG).expect(201);
    await upload(owner, JPEG, 'b.jpg').expect(201);
    const third = await upload(owner, WEBP, 'c.webp').expect(201);
    expect(third.body).toHaveLength(3);
    expect(third.body.map((p: { url: string }) => p.url.split('.').pop())).toEqual(['png', 'jpg', 'webp']);
    const fourth = await upload(owner, PNG).expect(400);
    expect(fourth.body.message).toMatch(/3 photos at most/);
  });

  it('search returns the photo URLs in order, and the unit list carries them for the owner', async () => {
    const search = await request(app.getHttpServer())
      .get('/search')
      .query({ date, timeWindow: 'ALL', durationMinutes: 60, lat: 10, lng: 76, radiusKm: 5, q: TEXT })
      .expect(200);
    const card = search.body.find((r: { resource: { id: string } }) => r.resource.id === unitId);
    const listed = (await owner.get(`/resources/${unitId}/photos`).expect(200)).body as Array<{ url: string }>;
    expect(card.resource.photoUrls).toEqual(listed.map((p) => p.url));
    const venueId = (await prisma.resource.findUniqueOrThrow({ where: { id: unitId } })).venueId;
    const units = (await owner.get('/resources').query({ venueId }).expect(200)).body;
    expect(units.find((u: { id: string }) => u.id === unitId).photos).toEqual(listed);
  });

  it('the owner can reorder (the first is the main photo) and remove photos', async () => {
    const photos = (await owner.get(`/resources/${unitId}/photos`).expect(200)).body as Array<{ id: string }>;
    const reversed = [...photos].reverse().map((p) => p.id);
    const reordered = await owner.put(`/resources/${unitId}/photos/order`).send({ photoIds: reversed }).expect(200);
    expect(reordered.body.map((p: { id: string }) => p.id)).toEqual(reversed);
    // Every photo, each once.
    await owner.put(`/resources/${unitId}/photos/order`).send({ photoIds: reversed.slice(0, 2) }).expect(400);

    const after = await owner.delete(`/resources/${unitId}/photos/${reversed[0]}`).expect(200);
    expect(after.body.map((p: { id: string }) => p.id)).toEqual(reversed.slice(1));
    await owner.delete(`/resources/${unitId}/photos/${reversed[0]}`).expect(404);
    // With a free place again, another upload is accepted.
    await upload(owner, PNG).expect(201);
  });

  it('refuses files that are not images, empty uploads, and other organizations', async () => {
    await upload(owner, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.png').expect(400);
    await owner.post(`/resources/${unitId}/photos`).expect(400);
    await upload(otherOwner, PNG).expect(403);
    await otherOwner.get(`/resources/${unitId}/photos`).expect(403);
    await request(app.getHttpServer()).get(`/resources/${unitId}/photos`).expect(401);
  });
});
