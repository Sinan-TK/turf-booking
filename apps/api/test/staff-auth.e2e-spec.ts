import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashPassword } from '@venue/database';
import { createTestApp } from './setup/test-app';
import { agentFor, createOwnerFixture, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';
import { StaffTokenService } from '../src/identity/staff-token.service';

/**
 * Self-hosted admin/owner auth: password login, httpOnly-cookie sessions,
 * refresh rotation with reuse detection, logout, and the single-use
 * invite / password-reset links. Keeps login attempts under the 10/min
 * throttle on /auth/:portal/login.
 */
describe('Staff auth (self-hosted)', () => {
  let app: INestApplication;
  let tokens: StaffTokenService;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    app = await createTestApp();
    tokens = app.get(StaffTokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdmin(withPassword = true) {
    const email = `e2e-staffauth-${uniqueSuffix()}@example.com`;
    const admin = await prisma.adminUser.create({
      data: {
        email,
        name: 'E2E Staff Auth',
        role: 'SUPER_ADMIN',
        passwordHash: withPassword ? await hashPassword(password) : null,
      },
    });
    return { admin, email };
  }

  function cookieValue(res: request.Response, name: string): string | undefined {
    const header = res.headers['set-cookie'] as unknown as string[] | undefined;
    const match = header?.find((c) => c.startsWith(`${name}=`));
    return match?.split(';')[0]?.slice(name.length + 1);
  }

  test('login sets httpOnly session cookies and /me works with the cookie jar', async () => {
    const { email } = await createAdmin();
    const agent = agentFor(app);

    const res = await agent.post('/auth/admin/login').send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('SUPER_ADMIN');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    const cookies = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(cookies).toMatch(/admin_access=.*HttpOnly/);
    expect(cookies).toMatch(/admin_refresh=.*HttpOnly/);

    expect((await agent.get('/auth/admin/me')).status).toBe(200);
  });

  test('wrong password, unknown email, and a not-yet-invited user are all 401', async () => {
    const { email } = await createAdmin();
    const { email: pendingEmail } = await createAdmin(false);

    const wrong = await request(app.getHttpServer()).post('/auth/admin/login').send({ email, password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    const unknown = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ email: `nobody-${uniqueSuffix()}@example.com`, password });
    expect(unknown.status).toBe(401);
    const pending = await request(app.getHttpServer()).post('/auth/admin/login').send({ email: pendingEmail, password });
    expect(pending.status).toBe(401);
  });

  test('an owner session cannot reach admin routes, and the portals are separate', async () => {
    const adminAgent = await loginAsSuperAdmin(app);
    const { ownerAgent } = await createOwnerFixture(app, adminAgent);

    expect((await ownerAgent.get('/auth/owner/me')).status).toBe(200);
    expect((await ownerAgent.get('/auth/admin/me')).status).toBe(403);

    // An owner's credentials don't work on the admin login endpoint.
    const owner = await prisma.venueOwnerUser.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    await prisma.venueOwnerUser.update({
      where: { id: owner.id },
      data: { passwordHash: await hashPassword(password) },
    });
    const wrongPortal = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ email: owner.email, password });
    expect(wrongPortal.status).toBe(401);
    const rightPortal = await request(app.getHttpServer())
      .post('/auth/owner/login')
      .send({ email: owner.email, password });
    expect(rightPortal.status).toBe(200);
    expect(rightPortal.body.organizationId).toBe(owner.organizationId);
  });

  test('refresh rotates the token; replaying the old one fails and revokes the family', async () => {
    const { email } = await createAdmin();
    const agent = agentFor(app);
    const login = await agent.post('/auth/admin/login').send({ email, password });
    const oldRefresh = cookieValue(login, 'admin_refresh') as string;

    const refreshed = await agent.post('/auth/admin/refresh');
    expect(refreshed.status).toBe(200);
    const newRefresh = cookieValue(refreshed, 'admin_refresh') as string;
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(oldRefresh);

    // Inside the 30s race-grace window a replay is just rejected...
    const replay = await request(app.getHttpServer())
      .post('/auth/admin/refresh')
      .set('Cookie', `admin_refresh=${oldRefresh}`);
    expect(replay.status).toBe(401);

    // ...and past it, it's treated as theft: every session is revoked.
    await prisma.staffRefreshSession.updateMany({
      where: { tokenHash: tokens.hashOpaqueToken(oldRefresh) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const theft = await request(app.getHttpServer())
      .post('/auth/admin/refresh')
      .set('Cookie', `admin_refresh=${oldRefresh}`);
    expect(theft.status).toBe(401);
    const afterTheft = await request(app.getHttpServer())
      .post('/auth/admin/refresh')
      .set('Cookie', `admin_refresh=${newRefresh}`);
    expect(afterTheft.status).toBe(401);
  });

  test('logout revokes the refresh session', async () => {
    const { email } = await createAdmin();
    const agent = agentFor(app);
    const login = await agent.post('/auth/admin/login').send({ email, password });
    const refresh = cookieValue(login, 'admin_refresh') as string;

    expect((await agent.post('/auth/admin/logout')).status).toBe(204);
    expect((await agent.get('/auth/admin/me')).status).toBe(401);
    const res = await request(app.getHttpServer())
      .post('/auth/admin/refresh')
      .set('Cookie', `admin_refresh=${refresh}`);
    expect(res.status).toBe(401);
  });

  test('a disabled user cannot refresh', async () => {
    const { admin, email } = await createAdmin();
    const agent = agentFor(app);
    await agent.post('/auth/admin/login').send({ email, password });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { status: 'DISABLED' } });
    expect((await agent.post('/auth/admin/refresh')).status).toBe(401);
  });
});
