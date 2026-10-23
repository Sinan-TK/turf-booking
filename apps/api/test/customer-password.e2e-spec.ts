import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { agentFor, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';
import { MailService, type MailMessage } from '../src/identity/mail.service';

/**
 * Customer email + password: sign-up, sign-in, the emailed reset link (captured from the real mail service call),
 * and changing a password. A customer who only used Google has no password and gets one through Forgot password.
 */
describe('Customer email + password', () => {
  let app: INestApplication;
  const sent: MailMessage[] = [];
  const email = () => `pw-${uniqueSuffix()}@example.com`;
  const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const PASSWORD = 'a-long-password';

  const signup = (e = email(), over: Record<string, unknown> = {}) =>
    agentFor(app)
      .post('/customer-auth/signup')
      .send({ name: 'Pw Person', email: e, phone: phone(), password: PASSWORD, ...over });
  const login = (e: string, password: string) => request(app.getHttpServer()).post('/customer-auth/login').send({ email: e, password });
  const forgot = (e: string) => request(app.getHttpServer()).post('/customer-auth/forgot-password').send({ email: e });
  const reset = (token: string, password: string) => request(app.getHttpServer()).post('/customer-auth/reset-password').send({ token, password });
  const lastTokenFor = (to: string) => {
    const mail = [...sent].reverse().find((m) => m.to === to);
    const m = mail && /reset-password\?token=([^\s"&<]+)/.exec(mail.text);
    return m ? decodeURIComponent(m[1]!) : undefined;
  };
  const rowByEmail = (e: string) => prisma.customerProfile.findUniqueOrThrow({ where: { email: e } });
  const googleOnly = async (e = email()) => {
    const agent = agentFor(app);
    const res = await agent.post('/customer-auth/google').send({ credential: `test:${e}|Google Person` });
    expect(res.status).toBe(200);
    return { agent, e, id: res.body.customer.id as string };
  };
  /** Pretend the 60-second cooldown has passed. */
  const ageTokens = (customerId: string) =>
    prisma.customerAuthToken.updateMany({ where: { customerId }, data: { createdAt: new Date(Date.now() - 120_000) } });

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    jest.spyOn(app.get(MailService, { strict: false }), 'send').mockImplementation(async (m) => {
      sent.push(m);
      return true;
    });
  });
  afterAll(async () => {
    await app.close();
  });

  describe('sign-up', () => {
    test('creates the account, its wallet and a session; neither email nor phone is verified yet', async () => {
      const e = email();
      const agent = agentFor(app);
      const p = phone();
      const res = await agent.post('/customer-auth/signup').send({ name: '  Pw Person ', email: e.toUpperCase(), phone: p.slice(3), password: PASSWORD });
      expect(res.status).toBe(201);
      expect(res.body.customer).toMatchObject({
        name: 'Pw Person',
        email: e,
        emailVerified: false,
        phone: p,
        phoneVerified: false,
        hasPassword: true,
        needsProfile: false,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt\$/);
      expect(String(res.headers['set-cookie'])).toMatch(/customer_session=.*HttpOnly/);
      const row = await prisma.customerProfile.findUniqueOrThrow({ where: { email: e }, include: { coinWallet: true } });
      expect(row.coinWallet).not.toBeNull();
      expect(row.passwordHash).toMatch(/^scrypt\$/);
      expect((await agent.get('/customer-auth/me')).body.email).toBe(e);
    });

    test('rejects a missing name, a bad email, a short password and a bad phone number', async () => {
      expect((await signup(email(), { name: '' })).status).toBe(400);
      expect((await signup('not-an-email')).status).toBe(400);
      expect((await signup(email(), { password: 'short' })).status).toBe(400);
      expect((await signup(email(), { password: 'x'.repeat(129) })).status).toBe(400);
      expect((await signup(email(), { phone: '12' })).status).toBe(400);
    });

    test('an email that is already registered is refused, whatever its case', async () => {
      const e = email();
      expect((await signup(e)).status).toBe(201);
      const again = await signup(e.toUpperCase());
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.body)).toMatch(/already registered/);
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(1);
    });

    test('the same unverified phone number may be used by two sign-ups; a verified one may not', async () => {
      const p = phone();
      expect((await signup(email(), { phone: p })).status).toBe(201);
      expect((await signup(email(), { phone: p })).status).toBe(201);
      await prisma.customerProfile.updateMany({ where: { whatsappNumber: p }, data: { whatsappNumber: null } });
      await prisma.customerProfile.create({ data: { whatsappNumber: p, phoneVerified: true } });
      const taken = await signup(email(), { phone: p });
      expect(taken.status).toBe(409);
      expect(JSON.stringify(taken.body)).toMatch(/registered to another account/);
    });
  });

  describe('sign-in', () => {
    test('works with the right password, in any letter case, and sets a session', async () => {
      const e = email();
      await signup(e);
      const res = await login(e.toUpperCase(), PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.customer.email).toBe(e);
      expect(String(res.headers['set-cookie'])).toMatch(/customer_session=/);
    });

    test('every failure is the same 401: wrong password, unknown email, Google-only account, blocked account', async () => {
      const e = email();
      await signup(e);
      const google = await googleOnly();
      const blockedEmail = email();
      const blocked = await signup(blockedEmail);
      await prisma.customerProfile.update({ where: { id: blocked.body.customer.id }, data: { status: 'BLOCKED' } });

      const responses = await Promise.all([
        login(e, 'wrong-password'),
        login(email(), PASSWORD),
        login(google.e, PASSWORD),
        login(blockedEmail, PASSWORD),
      ]);
      for (const r of responses) {
        expect(r.status).toBe(401);
        expect(r.body).toEqual(responses[0]!.body);
        expect(r.headers['set-cookie']).toBeUndefined();
      }
      expect(responses[0]!.body.message).toBe('Incorrect email or password');
    });
  });

  describe('forgot password and reset', () => {
    test('the answer is identical for a known, an unknown and a blocked address, and only the real one gets a link', async () => {
      const e = email();
      await signup(e);
      const blockedEmail = email();
      const b = await signup(blockedEmail);
      await prisma.customerProfile.update({ where: { id: b.body.customer.id }, data: { status: 'BLOCKED' } });
      const stranger = email();

      const [known, unknown, blocked] = [await forgot(e), await forgot(stranger), await forgot(blockedEmail)];
      for (const r of [known, unknown, blocked]) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true });
      }
      expect(lastTokenFor(e)).toBeTruthy();
      expect(lastTokenFor(stranger)).toBeUndefined();
      expect(lastTokenFor(blockedEmail)).toBeUndefined();
      const link = sent.find((m) => m.to === e)!.text;
      expect(link).toMatch(/\/reset-password\?token=/);
    });

    test('a link sent to one address cannot verify a different address typed in afterwards', async () => {
      const mine = email();
      const victim = email();
      const agent = agentFor(app);
      await agent.post('/customer-auth/signup').send({ name: 'Pw Person', email: mine, phone: phone(), password: PASSWORD }).expect(201);
      await forgot(mine);
      const link = lastTokenFor(mine)!;
      const changed = await agent.patch('/customer-auth/me').send({ email: victim });
      expect(changed.status).toBe(200);
      expect((await reset(link, 'new-password-1')).status).toBe(400); // issued for the old address
      expect((await rowByEmail(victim)).emailVerified).toBe(false);
    });

    test('an address can only be emailed once a minute, and a newer link replaces the older one', async () => {
      const e = email();
      const customer = await signup(e);
      await forgot(e);
      const first = lastTokenFor(e)!;
      const mailsBefore = sent.filter((m) => m.to === e).length;
      await forgot(e);
      await forgot(e);
      expect(sent.filter((m) => m.to === e).length).toBe(mailsBefore); // no flood
      expect(await prisma.customerAuthToken.count({ where: { customerId: customer.body.customer.id } })).toBe(1);

      await ageTokens(customer.body.customer.id);
      await forgot(e);
      const second = lastTokenFor(e)!;
      expect(second).not.toBe(first);
      expect((await reset(first, 'new-password-1')).status).toBe(400); // superseded
      expect((await reset(second, 'new-password-1')).status).toBe(200);
    });

    test('the link sets the password once, verifies the email, signs every session out and cannot be reused', async () => {
      const e = email();
      const agent = agentFor(app);
      const created = await agent.post('/customer-auth/signup').send({ name: 'Reset Me', email: e, phone: phone(), password: PASSWORD });
      expect(created.body.customer.emailVerified).toBe(false);
      await forgot(e);
      const token = lastTokenFor(e)!;

      expect((await reset(token, 'short')).status).toBe(400);
      expect((await reset('x'.repeat(30), 'new-password-1')).status).toBe(400);
      const ok = await reset(token, 'new-password-1');
      expect(ok.status).toBe(200);
      expect(ok.headers['set-cookie']).toBeUndefined(); // setting a password does not sign anyone in

      expect((await rowByEmail(e)).emailVerified).toBe(true);
      expect((await agent.get('/customer-auth/me')).status).toBe(401); // the old session was revoked
      expect((await login(e, PASSWORD)).status).toBe(401);
      expect((await login(e, 'new-password-1')).status).toBe(200);
      expect((await reset(token, 'another-password-2')).status).toBe(400); // single use
    });

    test('an expired link is refused', async () => {
      const e = email();
      const customer = await signup(e);
      await forgot(e);
      const token = lastTokenFor(e)!;
      await prisma.customerAuthToken.updateMany({ where: { customerId: customer.body.customer.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await reset(token, 'new-password-1');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/invalid or has expired/);
    });

    test('a link for a customer who has since been blocked is refused', async () => {
      const e = email();
      const customer = await signup(e);
      await forgot(e);
      const token = lastTokenFor(e)!;
      await prisma.customerProfile.update({ where: { id: customer.body.customer.id }, data: { status: 'BLOCKED' } });
      expect((await reset(token, 'new-password-1')).status).toBe(400);
    });

    test('a Google-only customer has no password until they use Forgot password', async () => {
      const g = await googleOnly();
      expect((await g.agent.get('/customer-auth/me')).body.hasPassword).toBe(false);
      expect((await login(g.e, PASSWORD)).status).toBe(401);

      await forgot(g.e);
      const token = lastTokenFor(g.e)!;
      expect(token).toBeTruthy();
      expect((await reset(token, 'google-person-pw')).status).toBe(200);

      const signedIn = await login(g.e, 'google-person-pw');
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.customer).toMatchObject({ id: g.id, hasPassword: true, emailVerified: true });
    });
  });

  describe('change password', () => {
    test('is refused, with the way forward, for a customer who has no password', async () => {
      const g = await googleOnly();
      const res = await g.agent.post('/customer-auth/change-password').send({ currentPassword: 'x', newPassword: 'brand-new-pw1' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/Forgot password/);
    });

    test('checks the current password, then replaces it, signs other devices out and keeps this one in', async () => {
      const e = email();
      const phoneOne = agentFor(app);
      await phoneOne.post('/customer-auth/signup').send({ name: 'Two Devices', email: e, phone: phone(), password: PASSWORD });
      const laptop = agentFor(app);
      expect((await laptop.post('/customer-auth/login').send({ email: e, password: PASSWORD })).status).toBe(200);

      expect((await phoneOne.post('/customer-auth/change-password').send({ currentPassword: 'nope', newPassword: 'brand-new-pw1' })).status).toBe(400);
      expect((await phoneOne.post('/customer-auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
      const ok = await phoneOne.post('/customer-auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'brand-new-pw1' });
      expect(ok.status).toBe(200);

      expect((await phoneOne.get('/customer-auth/me')).status).toBe(200); // a fresh session replaced it
      expect((await laptop.get('/customer-auth/me')).status).toBe(401); // the other device is signed out
      expect((await login(e, PASSWORD)).status).toBe(401);
      expect((await login(e, 'brand-new-pw1')).status).toBe(200);
    });

    test('needs a signed-in customer', async () => {
      const res = await request(app.getHttpServer()).post('/customer-auth/change-password').send({ currentPassword: 'x', newPassword: 'brand-new-pw1' });
      expect(res.status).toBe(401);
    });
  });

  test('the password hash never leaves the server: not to the customer, not to an admin', async () => {
    const e = email();
    const created = await signup(e);
    const admin = await loginAsSuperAdmin(app);
    const detail = await admin.get(`/admin/customers/${created.body.customer.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.hasPassword).toBe(true);
    const list = await admin.get(`/admin/customers?search=${encodeURIComponent(e)}`);
    expect(list.body[0].hasPassword).toBe(true);
    for (const body of [detail.body, list.body, created.body]) {
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|scrypt\$/);
    }
    const status = await admin.patch(`/admin/customers/${created.body.customer.id}/status`).send({ status: 'BLOCKED' });
    expect(JSON.stringify(status.body)).not.toMatch(/passwordHash|scrypt\$/);
  });
});
