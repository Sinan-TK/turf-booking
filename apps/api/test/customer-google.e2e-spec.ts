import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { agentFor, prisma, uniqueSuffix } from './setup/fixtures';

/**
 * Customer sign-in with Google. The verifier runs in fake mode here (test:<email>|<name>|<sub> tokens); what it
 * must enforce on real tokens is covered in google-verifier.e2e-spec.ts. Everything after verification (profile,
 * wallet, session, the email rules) is the real code.
 */
describe('Customer sign-in with Google', () => {
  let app: INestApplication;
  const email = () => `g-${uniqueSuffix()}@example.com`;
  const token = (e: string, name = 'Ria Menon', sub = `sub-${e}`) => `test:${e}|${name}|${sub}`;

  const google = (agent: ReturnType<typeof agentFor>, credential: string) => agent.post('/customer-auth/google').send({ credential });

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
  });
  afterAll(async () => {
    await app.close();
  });

  test('a first sign-in creates the profile, its wallet and a session, and asks for a phone number', async () => {
    const agent = agentFor(app);
    const e = email();
    const res = await google(agent, token(e, 'Ria Menon'));
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({
      name: 'Ria Menon',
      email: e,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      hasPassword: false,
      needsProfile: true,
    });
    expect(res.body.needsProfile).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|googleSub/);
    expect(String(res.headers['set-cookie'])).toMatch(/customer_session=.*HttpOnly/);

    const row = await prisma.customerProfile.findUniqueOrThrow({ where: { id: res.body.customer.id }, include: { coinWallet: true } });
    expect(row.googleSub).toBe(`sub-${e}`);
    expect(row.coinWallet).not.toBeNull();

    // The cookie is a working session.
    const me = await agent.get('/customer-auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(e);
  });

  test('signing in again with the same Google account returns the same customer', async () => {
    const e = email();
    const first = await google(agentFor(app), token(e));
    const second = await google(agentFor(app), token(e, 'A Different Display Name'));
    expect(second.body.customer.id).toBe(first.body.customer.id);
    expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(1);
    expect(second.body.customer.name).toBe('Ria Menon'); // their own name is not overwritten by Google's
  });

  test('a token that is not valid is refused without a session', async () => {
    for (const credential of ['garbage', 'eyJhbGciOiJSUzI1NiJ9.e30.bad', 'test:', 'test:not-an-email']) {
      const res = await google(agentFor(app), credential);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect((await agentFor(app).post('/customer-auth/google').send({})).status).toBe(400);
  });

  test('a blocked customer cannot sign in', async () => {
    const e = email();
    const first = await google(agentFor(app), token(e));
    await prisma.customerProfile.update({ where: { id: first.body.customer.id }, data: { status: 'BLOCKED' } });
    const res = await google(agentFor(app), token(e));
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  test('a mailbox already proven (by a reset link) is linked to the Google account, keeping its password', async () => {
    const e = email();
    const subLinked = `sub-linked-${uniqueSuffix()}`;
    const signup = await request(app.getHttpServer())
      .post('/customer-auth/signup')
      .send({ name: 'Linked Person', email: e, phone: '+919800000001', password: 'a-long-password' });
    expect(signup.status).toBe(201);
    await prisma.customerProfile.update({ where: { id: signup.body.customer.id }, data: { emailVerified: true } });

    const res = await google(agentFor(app), token(e, 'Linked Person', subLinked));
    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(signup.body.customer.id);
    expect(res.body.customer.hasPassword).toBe(true);
    expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: signup.body.customer.id } })).googleSub).toBe(subLinked);
  });

  test('an email someone typed without proving it is taken over by the real owner, who has just proved it', async () => {
    const e = email();
    const squatter = agentFor(app);
    const signup = await squatter
      .post('/customer-auth/signup')
      .send({ name: 'Not The Owner', email: e, phone: '+919800000002', password: 'squatters-password' });
    expect(signup.status).toBe(201);

    const owner = await google(agentFor(app), token(e, 'The Real Owner'));
    expect(owner.status).toBe(200);
    expect(owner.body.customer.id).not.toBe(signup.body.customer.id); // a fresh, separate profile
    expect(owner.body.customer).toMatchObject({ email: e, emailVerified: true, name: 'The Real Owner' });

    // The other profile keeps existing but no longer has the email or the password tied to it.
    const old = await prisma.customerProfile.findUniqueOrThrow({ where: { id: signup.body.customer.id } });
    expect(old.email).toBeNull();
    expect(old.passwordHash).toBeNull();
    expect(old.name).toBe('Not The Owner');
    expect((await squatter.get('/customer-auth/me')).status).toBe(200); // their session is untouched
    expect(await prisma.auditLog.count({ where: { action: 'EMAIL_UNVERIFIED_CLEARED', entityId: old.id } })).toBe(1);

    // And the squatter's password no longer signs in to anything.
    const login = await request(app.getHttpServer()).post('/customer-auth/login').send({ email: e, password: 'squatters-password' });
    expect(login.status).toBe(401);
  });

  test('an email verified for a different Google account is refused', async () => {
    const e = email();
    await google(agentFor(app), token(e, 'First', `sub-one-${uniqueSuffix()}`));
    const res = await google(agentFor(app), token(e, 'Second', `sub-two-${uniqueSuffix()}`));
    expect(res.status).toBe(409);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  describe('own profile', () => {
    test('a Google customer adds a phone number: it is saved normalized and stays unverified', async () => {
      const agent = agentFor(app);
      await google(agent, token(email()));
      const res = await agent.patch('/customer-auth/me').send({ phone: '98765 43210' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ phone: '+919876543210', phoneVerified: false, needsProfile: false });
      const bad = await agent.patch('/customer-auth/me').send({ phone: '12' });
      expect(bad.status).toBe(400);
      expect((await agent.get('/customer-auth/me')).body.phone).toBe('+919876543210');
    });

    test('name can be changed; an empty update is refused', async () => {
      const agent = agentFor(app);
      await google(agent, token(email(), 'Old Name'));
      expect((await agent.patch('/customer-auth/me').send({ name: '  New Name ' })).body.name).toBe('New Name');
      expect((await agent.patch('/customer-auth/me').send({})).status).toBe(400);
      expect((await agent.patch('/customer-auth/me').send({ name: '' })).status).toBe(400);
    });

    test('a verified email cannot be changed from here', async () => {
      const agent = agentFor(app);
      await google(agent, token(email()));
      const res = await agent.patch('/customer-auth/me').send({ email: email() });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/verified/);
    });

    test('profile endpoints need a customer session', async () => {
      expect((await agentFor(app).get('/customer-auth/me')).status).toBe(401);
      expect((await agentFor(app).patch('/customer-auth/me').send({ name: 'x' })).status).toBe(401);
    });
  });
});
