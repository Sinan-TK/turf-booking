import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashPassword } from '@venue/database';
import { createTestApp } from './setup/test-app';
import { agentFor, prisma, uniqueSuffix } from './setup/fixtures';
import { StaffTokenService } from '../src/identity/staff-token.service';

/**
 * Invite / password-reset links, forgot-password and change-password. A
 * separate file from staff-auth.e2e-spec.ts only so each gets its own app
 * (and its own in-memory login throttle counter).
 */
describe('Staff auth links & password changes', () => {
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

  test('a single-use link sets the password once; the old password stops working', async () => {
    const { admin, email } = await createAdmin();
    const { raw, hash } = tokens.generateOpaqueToken();
    await prisma.staffAuthToken.create({
      data: {
        portal: 'ADMIN',
        userId: admin.id,
        purpose: 'PASSWORD_RESET',
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const tooShort = await request(app.getHttpServer())
      .post('/auth/admin/reset-password')
      .send({ token: raw, password: 'short' });
    expect(tooShort.status).toBe(400);

    const newPassword = 'a-brand-new-password';
    const ok = await request(app.getHttpServer())
      .post('/auth/admin/reset-password')
      .send({ token: raw, password: newPassword });
    expect(ok.status).toBe(200);

    const reuse = await request(app.getHttpServer())
      .post('/auth/admin/reset-password')
      .send({ token: raw, password: 'yet-another-password' });
    expect(reuse.status).toBe(400);

    const oldLogin = await request(app.getHttpServer()).post('/auth/admin/login').send({ email, password });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
  });

  test('an expired link and a link for the other portal are rejected', async () => {
    const { admin } = await createAdmin(false);
    const expired = tokens.generateOpaqueToken();
    await prisma.staffAuthToken.create({
      data: {
        portal: 'ADMIN',
        userId: admin.id,
        purpose: 'INVITE',
        tokenHash: expired.hash,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const live = tokens.generateOpaqueToken();
    await prisma.staffAuthToken.create({
      data: {
        portal: 'ADMIN',
        userId: admin.id,
        purpose: 'INVITE',
        tokenHash: live.hash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const body = (token: string) => ({ token, password: 'long-enough-password' });
    expect(
      (await request(app.getHttpServer()).post('/auth/admin/reset-password').send(body(expired.raw))).status,
    ).toBe(400);
    expect(
      (await request(app.getHttpServer()).post('/auth/owner/reset-password').send(body(live.raw))).status,
    ).toBe(400);
    // Invite acceptance: a passwordless user can then log in.
    expect(
      (await request(app.getHttpServer()).post('/auth/admin/reset-password').send(body(live.raw))).status,
    ).toBe(200);
  });

  test('forgot-password answers 200 for known and unknown emails alike', async () => {
    const { email } = await createAdmin();
    const known = await request(app.getHttpServer()).post('/auth/admin/forgot-password').send({ email });
    const unknown = await request(app.getHttpServer())
      .post('/auth/admin/forgot-password')
      .send({ email: `ghost-${uniqueSuffix()}@example.com` });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  test('change-password requires the current password and ends other sessions', async () => {
    const { email } = await createAdmin();
    const agent = agentFor(app);
    const first = await agent.post('/auth/admin/login').send({ email, password });
    const otherDeviceRefresh = cookieValue(first, 'admin_refresh') as string;

    const bad = await agent
      .post('/auth/admin/change-password')
      .send({ currentPassword: 'wrong-wrong-wrong', newPassword: 'another-new-password' });
    expect(bad.status).toBe(400);

    const ok = await agent
      .post('/auth/admin/change-password')
      .send({ currentPassword: password, newPassword: 'another-new-password' });
    expect(ok.status).toBe(200);
    expect((await agent.get('/auth/admin/me')).status).toBe(200);

    const stale = await request(app.getHttpServer())
      .post('/auth/admin/refresh')
      .set('Cookie', `admin_refresh=${otherDeviceRefresh}`);
    expect(stale.status).toBe(401);
  });
});
