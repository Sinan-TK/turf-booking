import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const hour = 3_600_000;

/** Advertising banners for the landing page: the Super Admin manages them; customers see only the ones on show right now. */
describe('Landing page banners', () => {
  let app: INestApplication;
  let admin: TestAgent;
  const title = (s: string) => `E2E ${s} ${uniqueSuffix()}`;
  const http = () => request(app.getHttpServer());
  const live = async () => (await http().get('/banners').expect(200)).body as Array<{ id: string; title: string; subtitle: string | null; linkUrl: string | null; imageUrl: string | null }>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
  });
  afterAll(async () => {
    await prisma.banner.deleteMany({ where: { title: { startsWith: 'E2E ' } } });
    await app.close();
  });

  it('a new banner is on show at once, with its link, and the public list carries nothing internal', async () => {
    const t = title('Live');
    const made = await admin.post('/admin/banners').send({ title: t, subtitle: 'Book today', linkUrl: '/explore?type=FOOTBALL_TURF' }).expect(201);
    const row = (await live()).find((b) => b.id === made.body.id)!;
    expect(row).toEqual({ id: made.body.id, title: t, subtitle: 'Book today', linkUrl: '/explore?type=FOOTBALL_TURF', imageUrl: null });
    expect(Object.keys(row).sort()).toEqual(['id', 'imageUrl', 'linkUrl', 'subtitle', 'title']);
  });

  it('links must be a path on this site or an https address', async () => {
    const t = title('Link');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', 'http://insecure.example', 'not a link', 'https://']) {
      expect((await admin.post('/admin/banners').send({ title: t, linkUrl: bad })).status).toBe(400);
    }
    for (const good of ['/explore', '/support', 'https://example.com/offer?x=1']) {
      expect((await admin.post('/admin/banners').send({ title: t, linkUrl: good })).status).toBe(201);
    }
  });

  it('is shown only while switched on and inside its dates', async () => {
    const now = Date.now();
    const soon = await admin.post('/admin/banners').send({ title: title('Soon'), startsAt: new Date(now + hour).toISOString() }).expect(201);
    const over = await admin.post('/admin/banners').send({ title: title('Over'), startsAt: new Date(now - 2 * hour).toISOString(), endsAt: new Date(now - hour).toISOString() }).expect(201);
    const now1 = await admin.post('/admin/banners').send({ title: title('Now'), startsAt: new Date(now - hour).toISOString(), endsAt: new Date(now + hour).toISOString() }).expect(201);
    const ids = (await live()).map((b) => b.id);
    expect(ids).toContain(now1.body.id);
    expect(ids).not.toContain(soon.body.id);
    expect(ids).not.toContain(over.body.id);

    await admin.patch(`/admin/banners/${now1.body.id}`).send({ isActive: false }).expect(200);
    expect((await live()).map((b) => b.id)).not.toContain(now1.body.id);
    const listed = (await admin.get('/admin/banners').expect(200)).body as Array<{ id: string; live: boolean; scheduled: boolean; ended: boolean }>;
    expect(listed.find((b) => b.id === soon.body.id)).toMatchObject({ live: false, scheduled: true, ended: false });
    expect(listed.find((b) => b.id === over.body.id)).toMatchObject({ live: false, ended: true });
    expect(listed.find((b) => b.id === now1.body.id)).toMatchObject({ live: false });
  });

  it('an end before the start is refused, also when only one of the two is changed', async () => {
    const now = Date.now();
    expect((await admin.post('/admin/banners').send({ title: title('Dates'), startsAt: new Date(now + hour).toISOString(), endsAt: new Date(now).toISOString() })).status).toBe(400);
    const b = await admin.post('/admin/banners').send({ title: title('Dates'), startsAt: new Date(now + hour).toISOString() }).expect(201);
    expect((await admin.patch(`/admin/banners/${b.body.id}`).send({ endsAt: new Date(now).toISOString() })).status).toBe(400);
  });

  it('banners show in the order set, lowest number first', async () => {
    const a = await admin.post('/admin/banners').send({ title: title('Order B'), sortOrder: 900 }).expect(201);
    const b = await admin.post('/admin/banners').send({ title: title('Order A'), sortOrder: 899 }).expect(201);
    const ids = (await live()).map((x) => x.id);
    expect(ids.indexOf(b.body.id)).toBeLessThan(ids.indexOf(a.body.id));
  });

  it('a picture is kept in the banners/ folder, replaced, and removed with the banner', async () => {
    const made = await admin.post('/admin/banners').send({ title: title('Pic') }).expect(201);
    const id = made.body.id as string;
    const up = await admin.post(`/admin/banners/${id}/image`).attach('file', PNG, 'b.png').expect(201);
    expect(up.body.imageUrl).toMatch(new RegExp(`/banners/${id}/[0-9a-f-]{36}\\.png$`));
    expect(up.body).not.toHaveProperty('imageKey');
    expect((await live()).find((b) => b.id === id)?.imageUrl).toBe(up.body.imageUrl);
    expect((await admin.post(`/admin/banners/${id}/image`).attach('file', Buffer.from('<svg/>'), 'x.png')).status).toBe(400);
    const cleared = await admin.delete(`/admin/banners/${id}/image`).expect(200);
    expect(cleared.body.imageUrl).toBeNull();
    await admin.post(`/admin/banners/${id}/image`).attach('file', PNG, 'b.png').expect(201);
    await admin.delete(`/admin/banners/${id}`).expect(200);
    expect((await live()).some((b) => b.id === id)).toBe(false);
    expect((await admin.post(`/admin/banners/${id}/image`).attach('file', PNG, 'b.png')).status).toBe(404);
  });

  it('only the Super Admin can manage banners', async () => {
    const { ownerAgent } = await createOwnerFixture(app, admin);
    expect([401, 403]).toContain((await ownerAgent.post('/admin/banners').send({ title: 'x' })).status);
    expect([401, 403]).toContain((await ownerAgent.get('/admin/banners')).status);
    expect((await http().post('/admin/banners').send({ title: 'x' })).status).toBe(401);
  });
});
