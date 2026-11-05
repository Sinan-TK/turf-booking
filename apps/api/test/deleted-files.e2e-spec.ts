import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const keyOf = (url: string) => url.split('/media/')[1]!;

/**
 * The bucket's key cannot delete files, so every file the app stops using is written to a list for the Super Admin: what it was, who removed it,
 * whether it is still in the bucket. The photo rows themselves are removed as always (so they are never shown or counted again).
 */
describe('Deleted files', () => {
  let app: INestApplication;
  let admin: Awaited<ReturnType<typeof loginAsSuperAdmin>>;
  let owner: Awaited<ReturnType<typeof createOwnerFixture>>['ownerAgent'];
  let venue: Awaited<ReturnType<typeof createVenueFixture>>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    owner = (await createOwnerFixture(app, admin)).ownerAgent;
    venue = await createVenueFixture(app, owner, admin);
    // Earlier runs may have left rows on the list: start from an empty waiting list.
    await prisma.deletedFile.updateMany({ where: { removedAt: null }, data: { removedAt: new Date() } });
  });
  afterAll(async () => {
    await app.close();
  });

  const addPhoto = async (path: string) => {
    const res = await owner.post(path).attach('file', PNG, 'p.png').expect(201);
    return res.body as Array<{ id: string; url: string }>;
  };
  const row = (key: string) => prisma.deletedFile.findUnique({ where: { key } });

  it('removing a unit photo lists its file (what it was, where, who) and frees a slot of the three', async () => {
    const path = `/resources/${venue.halfAId}/photos`;
    await addPhoto(path);
    await addPhoto(path);
    const three = await addPhoto(path);
    expect((await owner.post(path).attach('file', PNG, 'p.png')).status).toBe(400); // a fourth is refused

    const gone = three[1]!;
    const left = await owner.delete(`${path}/${gone.id}`).expect(200);
    expect(left.body).toHaveLength(2);
    expect(left.body.some((p: { id: string }) => p.id === gone.id)).toBe(false);

    const listed = await row(keyOf(gone.url));
    expect(listed).toMatchObject({ source: 'UNIT_PHOTO', deletedByType: 'OWNER', venueId: venue.venueId, removedAt: null });
    expect(listed?.label).toContain('5s Half A');

    await addPhoto(path); // the freed slot can be used again
    expect((await owner.post(path).attach('file', PNG, 'p.png')).status).toBe(400);
  });

  it('a pooled item photo is listed as a group photo', async () => {
    const category = await prisma.venueCategory.findFirstOrThrow({ where: { slug: 'FOOTBALL_TURF' } });
    const group = await prisma.resourceGroup.create({ data: { venueId: venue.venueId, categoryId: category.id, name: 'Kayaks', allocationMode: 'POOLED', totalUnits: 3 } });
    const photos = await addPhoto(`/resources/groups/${group.id}/photos`);
    await owner.delete(`/resources/groups/${group.id}/photos/${photos[0]!.id}`).expect(200);
    expect(await row(keyOf(photos[0]!.url))).toMatchObject({ source: 'GROUP_PHOTO', removedAt: null });
  });

  it('a banner picture that is replaced or removed, and a facility picture that is removed, are listed too', async () => {
    const made = await admin.post('/admin/banners').send({ title: `E2E Pic ${uniqueSuffix()}` }).expect(201);
    const first = await admin.post(`/admin/banners/${made.body.id}/image`).attach('file', PNG, 'b.png').expect(201);
    const firstKey = keyOf(first.body.imageUrl);
    await admin.post(`/admin/banners/${made.body.id}/image`).attach('file', PNG, 'b.png').expect(201); // replaces it
    expect(await row(firstKey)).toMatchObject({ source: 'BANNER', deletedByType: 'ADMIN' });
    await admin.delete(`/admin/banners/${made.body.id}`).expect(200);

    const category = await prisma.venueCategory.findFirstOrThrow({ where: { slug: 'FOOTBALL_TURF' } });
    await prisma.venueCategory.update({ where: { id: category.id }, data: { imageKey: null } });
    const set = await admin.post(`/admin/categories/${category.id}/image`).attach('file', PNG, 'f.png').expect(201);
    const catKey = keyOf(set.body.imageUrl);
    await admin.delete(`/admin/categories/${category.id}/image`).expect(200);
    expect(await row(catKey)).toMatchObject({ source: 'CATEGORY_IMAGE', deletedByType: 'ADMIN' });
  });

  it('removing the same file twice lists it once', async () => {
    const path = `/resources/${venue.halfBId}/photos`;
    const photos = await addPhoto(path);
    await owner.delete(`${path}/${photos[0]!.id}`).expect(200);
    expect((await owner.delete(`${path}/${photos[0]!.id}`)).status).toBe(404);
    expect(await prisma.deletedFile.count({ where: { key: keyOf(photos[0]!.url) } })).toBe(1);
  });

  describe('the Super Admin list', () => {
    const keys: string[] = [];
    let removedBefore = 0;
    beforeAll(async () => {
      await prisma.deletedFile.updateMany({ where: { removedAt: null }, data: { removedAt: new Date() } });
      for (let i = 0; i < 3; i++) {
        const key = `venues/e2e/${uniqueSuffix()}-${i}.png`;
        keys.push(key);
        await prisma.deletedFile.create({ data: { key, source: 'UNIT_PHOTO', label: `Listed Arena ${i} · Turf`, deletedByType: 'OWNER' } });
      }
      removedBefore = await prisma.deletedFile.count({ where: { removedAt: { not: null } } });
    });

    it('lists the waiting files with their address, counts them, filters, searches and pages', async () => {
      const all = await admin.get('/admin/deleted-files').expect(200);
      expect(all.headers['x-total-count']).toBe('3');
      expect(all.body.map((r: { key: string }) => r.key).sort()).toEqual([...keys].sort());
      expect(all.body[0].url).toContain(all.body[0].key);

      expect((await admin.get('/admin/deleted-files').query({ search: 'Arena 1' }).expect(200)).body).toHaveLength(1);
      expect((await admin.get('/admin/deleted-files').query({ status: 'removed' }).expect(200)).headers['x-total-count']).toBe(String(removedBefore));
      const page = await admin.get('/admin/deleted-files').query({ limit: 2, offset: 2 }).expect(200);
      expect(page.body).toHaveLength(1);
      expect(page.headers['x-total-count']).toBe('3');
      expect((await admin.get('/admin/deleted-files/summary').expect(200)).body).toMatchObject({ waiting: 3 });
      expect((await admin.get('/admin/deleted-files').query({ status: 'nonsense' })).status).toBe(400);
    });

    it('exports the waiting keys, one per line', async () => {
      const res = await admin.get('/admin/deleted-files/export').expect(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text.trim().split('\n').sort()).toEqual([...keys].sort());
    });

    it('marking removed is idempotent and moves a file to the removed list', async () => {
      const [a, b] = await Promise.all(keys.slice(0, 2).map((k) => prisma.deletedFile.findUniqueOrThrow({ where: { key: k } })));
      expect((await admin.post(`/admin/deleted-files/${a!.id}/removed`).expect(200)).body).toEqual({ marked: 1 });
      expect((await admin.post(`/admin/deleted-files/${a!.id}/removed`).expect(200)).body).toEqual({ marked: 0 });
      expect((await admin.post('/admin/deleted-files/mark-removed').send({ ids: [a!.id, b!.id] }).expect(200)).body).toEqual({ marked: 1 });
      expect((await admin.get('/admin/deleted-files').query({ status: 'removed' }).expect(200)).headers['x-total-count']).toBe(String(removedBefore + 2));
      expect((await admin.get('/admin/deleted-files/summary').expect(200)).body).toMatchObject({ waiting: 1, removed: removedBefore + 2 });
      expect((await admin.post('/admin/deleted-files/mark-removed').send({ ids: [] })).status).toBe(400);
    });

    it('"check" marks the files that are gone from the bucket and leaves the ones still there', async () => {
      // One file that is really still stored: an owner photo whose list entry was added by hand.
      const path = `/resources/${venue.fullGroundId}/photos`;
      const photos = await addPhoto(path);
      const stillThere = keyOf(photos[0]!.url);
      await prisma.deletedFile.create({ data: { key: stillThere, source: 'UNIT_PHOTO', label: 'Still stored', deletedByType: 'OWNER' } });

      const res = await admin.post('/admin/deleted-files/check').expect(200);
      expect(res.body).toMatchObject({ checked: 2, nowGone: 1, stillThere: 1, failed: 0, remaining: 1 });
      expect((await row(keys[2]!))?.removedAt).not.toBeNull(); // no file was ever stored for this one
      expect((await row(stillThere))?.removedAt).toBeNull();
    });
  });

  it('only the Super Admin can see or change the list', async () => {
    const { agent: customer } = await createCustomerFixture(app);
    for (const agent of [owner, customer]) {
      expect((await agent.get('/admin/deleted-files')).status).toBeGreaterThanOrEqual(401);
      expect((await agent.post('/admin/deleted-files/check')).status).toBeGreaterThanOrEqual(401);
    }
    expect((await http().get('/admin/deleted-files')).status).toBe(401);
  });
});
