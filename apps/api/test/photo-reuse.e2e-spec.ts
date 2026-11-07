import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';
import { LOCAL_MEDIA_DIR } from '../src/storage/storage.service';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/**
 * One picture on several units, or on units of several venues of the same owner: the owner picks it from what they already have
 * instead of uploading it again. The stored file is shared, and goes only when its last use is removed.
 */
describe('Reusing a photo on other units', () => {
  let app: INestApplication;
  let owner: TestAgent;
  let stranger: TestAgent;
  let admin: TestAgent;
  let v1: Awaited<ReturnType<typeof createVenueFixture>>;
  let v2: Awaited<ReturnType<typeof createVenueFixture>>;
  let strangerVenue: Awaited<ReturnType<typeof createVenueFixture>>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    stranger = (await createOwnerFixture(app, admin)).ownerAgent;
    v1 = await createVenueFixture(app, owner, admin);
    v2 = await createVenueFixture(app, owner, admin);
    strangerVenue = await createVenueFixture(app, stranger, admin);
  });
  afterAll(async () => app.close());

  const photosOf = async (unit: string) => (await owner.get(`/resources/${unit}/photos`).expect(200)).body as Array<{ id: string; url: string }>;
  const keyOf = async (id: string) => (await prisma.resourcePhoto.findUniqueOrThrow({ where: { id } })).key;
  const onDisk = (key: string) => existsSync(resolve(LOCAL_MEDIA_DIR, key));
  type Library = Array<{ id: string; url: string; from: string }>;
  const library = async (unit: string, agent: TestAgent = owner) => (await agent.get(`/resources/${unit}/photos/library`).expect(200)).body as Library;

  it('a photo already on one unit is offered to the others, named by where it is used, and not to the unit that has it', async () => {
    const [a] = (await owner.post(`/resources/${v1.fullGroundId}/photos`).attach('file', PNG, 'a.png').expect(201)).body as Array<{ id: string; url: string }>;
    const forOther = await library(v1.halfAId);
    expect(forOther).toHaveLength(1);
    expect(forOther[0]).toMatchObject({ url: a!.url });
    expect(forOther[0]!.from).toContain('·');
    expect(await library(v1.fullGroundId)).toEqual([]);
    // Another venue of the same owner sees it too.
    expect((await library(v2.halfAId)).map((p) => p.url)).toEqual([a!.url]);
  });

  it('reusing it gives the other unit the same file, on the same venue or on another one', async () => {
    const source = (await library(v1.halfAId))[0]!;
    const same = (await owner.post(`/resources/${v1.halfAId}/photos/reuse`).send({ photoId: source.id }).expect(201)).body as Array<{ id: string; url: string }>;
    expect(same).toHaveLength(1);
    expect(same[0]!.url).toBe(source.url);
    const cross = (await owner.post(`/resources/${v2.halfAId}/photos/reuse`).send({ photoId: source.id }).expect(201)).body as Array<{ url: string }>;
    expect(cross.map((p) => p.url)).toEqual([source.url]);

    // Three rows, one file.
    const key = await keyOf(source.id);
    expect(await prisma.resourcePhoto.count({ where: { key } })).toBe(3);
    expect(onDisk(key)).toBe(true);

    // The same photo cannot be added twice to one unit, and it is no longer offered to a unit that has it.
    expect((await owner.post(`/resources/${v1.halfAId}/photos/reuse`).send({ photoId: source.id }).expect(400)).body.message).toMatch(/already has/);
    expect((await library(v1.halfAId)).map((p) => p.url)).not.toContain(source.url);
  });

  it('the unit limit still applies to reused photos', async () => {
    const unit = v1.halfBId;
    await owner.post(`/resources/${unit}/photos`).attach('file', JPEG, 'b.jpg').expect(201);
    await owner.post(`/resources/${unit}/photos`).attach('file', PNG, 'c.png').expect(201);
    const offered = await library(unit);
    expect(offered.length).toBeGreaterThan(0);
    await owner.post(`/resources/${unit}/photos/reuse`).send({ photoId: offered[0]!.id }).expect(201);
    expect((await photosOf(unit)).length).toBe(3);
    expect((await owner.post(`/resources/${unit}/photos/reuse`).send({ photoId: offered[0]!.id }).expect(400)).body.message).toMatch(/3 photos at most|already has/);
    const other = offered.find((p) => p.id !== offered[0]!.id);
    if (other) expect((await owner.post(`/resources/${unit}/photos/reuse`).send({ photoId: other.id }).expect(400)).body.message).toMatch(/3 photos at most/);
  });

  it('removing a shared photo from one unit keeps it on the others; the file goes with its last use', async () => {
    const [mineHere] = await photosOf(v1.halfAId);
    const key = await keyOf(mineHere!.id);
    const uses = await prisma.resourcePhoto.count({ where: { key } });
    expect(uses).toBeGreaterThan(1);

    // Remove it from every unit but one: the file stays.
    const rows = await prisma.resourcePhoto.findMany({ where: { key }, select: { id: true, resourceId: true } });
    for (const row of rows.slice(0, -1)) await owner.delete(`/resources/${row.resourceId}/photos/${row.id}`).expect(200);
    expect(await prisma.resourcePhoto.count({ where: { key } })).toBe(1);
    expect(onDisk(key)).toBe(true);

    // The last use goes, and so does the file.
    const last = rows[rows.length - 1]!;
    await owner.delete(`/resources/${last.resourceId}/photos/${last.id}`).expect(200);
    expect(await prisma.resourcePhoto.count({ where: { key } })).toBe(0);
    expect(onDisk(key)).toBe(false);
  });

  it('another owner neither sees nor can use these photos, and cannot reuse into this owner’s units', async () => {
    const [mine] = (await owner.post(`/resources/${v1.fullGroundId}/photos`).attach('file', PNG, 'z.png').expect(201)).body as Array<{ id: string }>;
    // The stranger's own units list only their own photos.
    expect(await library(strangerVenue.fullGroundId, stranger)).toEqual([]);
    // A photo of someone else's cannot be picked.
    await stranger.post(`/resources/${strangerVenue.fullGroundId}/photos/reuse`).send({ photoId: mine!.id }).expect(404);
    // And their units cannot be touched by the owner, nor this owner's by them.
    await owner.get(`/resources/${strangerVenue.fullGroundId}/photos/library`).expect(403);
    await stranger.get(`/resources/${v1.fullGroundId}/photos/library`).expect(403);
    await stranger.post(`/resources/${v1.halfBId}/photos/reuse`).send({ photoId: mine!.id }).expect(403);
    expect(await prisma.resourcePhoto.count({ where: { resourceId: strangerVenue.fullGroundId } })).toBe(0);
  });

  it('a made-up photo id is refused', async () => {
    await owner.post(`/resources/${v2.fullGroundId}/photos/reuse`).send({ photoId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await owner.post(`/resources/${v2.fullGroundId}/photos/reuse`).send({ photoId: 'nope' }).expect(400);
  });
});
