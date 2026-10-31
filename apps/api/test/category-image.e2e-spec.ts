import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createCategoryFixture, createOwnerFixture, loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

// The smallest valid files of each accepted type (their first bytes are what the API checks).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

/** A facility's picture: set by the Super Admin, kept in the facilities/ folder, shown to customers as a URL. */
describe('facility picture', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let categoryId: string;

  const put = (id: string, bytes: Buffer, name = 'picture.png') => admin.post(`/admin/categories/${id}/image`).attach('file', bytes, name);
  const publicRow = async () => {
    const res = await request(app.getHttpServer()).get('/categories').expect(200);
    return (res.body as Array<{ id: string; imageUrl: string | null }>).find((c) => c.id === categoryId);
  };

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    categoryId = await createCategoryFixture(admin);
  });
  afterAll(async () => app.close());

  it('a facility starts with no picture', async () => {
    expect((await admin.get(`/admin/categories/${categoryId}`).expect(200)).body.imageUrl).toBeNull();
    expect((await publicRow())?.imageUrl).toBeNull();
  });

  it('uploading stores the file in the facilities folder and shows its URL to admins and customers, never the key', async () => {
    const res = await put(categoryId, PNG).expect(201);
    expect(res.body.imageUrl).toMatch(new RegExp(`/facilities/${categoryId}/[0-9a-f-]{36}\\.png$`));
    expect(res.body).not.toHaveProperty('imageKey');
    expect((await publicRow())?.imageUrl).toBe(res.body.imageUrl);
    const row = await prisma.venueCategory.findUniqueOrThrow({ where: { id: categoryId } });
    expect(row.imageKey).toMatch(new RegExp(`^facilities/${categoryId}/`));
  });

  it('replacing it swaps the picture and removing it clears it', async () => {
    const before = (await prisma.venueCategory.findUniqueOrThrow({ where: { id: categoryId } })).imageKey;
    const replaced = await put(categoryId, JPEG, 'new.jpg').expect(201);
    expect(replaced.body.imageUrl).toMatch(/\.jpg$/);
    expect((await prisma.venueCategory.findUniqueOrThrow({ where: { id: categoryId } })).imageKey).not.toBe(before);
    const removed = await admin.delete(`/admin/categories/${categoryId}/image`).expect(200);
    expect(removed.body.imageUrl).toBeNull();
    expect((await publicRow())?.imageUrl).toBeNull();
  });

  it('refuses a file that is not a picture, an empty upload and one that is too big', async () => {
    expect((await put(categoryId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.png')).status).toBe(400);
    expect((await put(categoryId, Buffer.from('not an image at all'), 'x.png')).status).toBe(400);
    expect((await admin.post(`/admin/categories/${categoryId}/image`)).status).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
    expect([400, 413]).toContain((await put(categoryId, big)).status);
    expect((await prisma.venueCategory.findUniqueOrThrow({ where: { id: categoryId } })).imageKey).toBeNull();
  });

  it('only the Super Admin can change it', async () => {
    const { ownerAgent } = await createOwnerFixture(app, admin);
    expect([401, 403]).toContain((await ownerAgent.post(`/admin/categories/${categoryId}/image`).attach('file', PNG, 'p.png')).status);
    expect([401, 403]).toContain((await ownerAgent.delete(`/admin/categories/${categoryId}/image`)).status);
    expect((await request(app.getHttpServer()).post(`/admin/categories/${categoryId}/image`).attach('file', PNG, 'p.png')).status).toBe(401);
  });

  it('an unknown facility is a 404', async () => {
    expect((await put('11111111-1111-4111-8111-111111111111', PNG)).status).toBe(404);
  });
});
