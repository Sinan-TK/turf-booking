import type { INestApplication } from '@nestjs/common';
import { hashPassword } from '@venue/database';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { agentFor, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';
import { MailService, type MailMessage } from '../src/identity/mail.service';

/**
 * Customer email + password: sign-up and password reset both proven by a six-digit code emailed to the address
 * (captured from the real mail service call), sign-in, and changing a password. A customer who only used Google
 * has no password and gets one through Forgot password.
 */
// Read when the app starts, so every code email in this file goes out through a Resend template.
process.env.RESEND_OTP_TEMPLATE_ID = 'tmpl_test_123';

describe('Customer email + password', () => {
  let app: INestApplication;
  const sent: MailMessage[] = [];
  const email = () => `pw-${uniqueSuffix()}@example.com`;
  const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const PASSWORD = 'a-long-password';

  const details = (e: string, over: Record<string, unknown> = {}) => ({ name: 'Pw Person', email: e, phone: phone(), password: PASSWORD, ...over });
  /** Step one of sign-up: checks the details and emails a code. */
  // The ticket the API hands the browser that started a sign-up, remembered per address like the browser would.
  const tickets = new Map<string, string>();
  const signupStart = async (e = email(), over: Record<string, unknown> = {}, agent = agentFor(app)) => {
    const res = await agent.post('/customer-auth/signup').send(details(e, over));
    if (res.status === 200) tickets.set(e.trim().toLowerCase(), res.body.ticket);
    return res;
  };
  const signupVerify = (e: string, code: string, agent = agentFor(app), ticket = tickets.get(e.trim().toLowerCase())) =>
    agent.post('/customer-auth/signup/verify').send({ email: e, code, ticket });
  /** Both steps. A refused first step is returned as is, so validation and conflict tests can look at it. */
  const signup = async (e = email(), over: Record<string, unknown> = {}, agent = agentFor(app)) => {
    const started = await signupStart(e, over, agent);
    if (started.status !== 200) return started;
    return signupVerify(e, lastCodeFor(e)!, agent);
  };
  const login = (e: string, password: string) => request(app.getHttpServer()).post('/customer-auth/login').send({ email: e, password });
  const forgot = (e: string) => request(app.getHttpServer()).post('/customer-auth/forgot-password').send({ email: e });
  const reset = (e: string, code: string, password: string) =>
    request(app.getHttpServer()).post('/customer-auth/reset-password').send({ email: e, code, password });
  const lastCodeFor = (to: string) => {
    const mail = [...sent].reverse().find((m) => m.to === to);
    return mail && /Your code: (\d{6})/.exec(mail.text)?.[1];
  };
  const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');
  const rowByEmail = (e: string) => prisma.customerProfile.findUniqueOrThrow({ where: { email: e } });
  const googleOnly = async (e = email()) => {
    const agent = agentFor(app);
    const res = await agent.post('/customer-auth/google').send({ credential: `test:${e}|Google Person` });
    expect(res.status).toBe(200);
    return { agent, e, id: res.body.customer.id as string };
  };
  /** Pretend the resend cooldown has passed. */
  const ageCodes = (e: string) => prisma.customerEmailCode.updateMany({ where: { email: e }, data: { createdAt: new Date(Date.now() - 120_000) } });

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
    test('emails a code and creates nothing until it comes back; then the account, wallet and session exist and the email is verified', async () => {
      const e = email();
      const agent = agentFor(app);
      const p = phone();
      const started = await signupStart(` ${e.toUpperCase()} `.trim(), { name: '  Pw Person ', phone: p.slice(3) }, agent);
      expect(started.status).toBe(200);
      expect(started.headers['set-cookie']).toBeUndefined();
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(0); // nothing yet
      const code = lastCodeFor(e)!;
      expect(code).toMatch(/^\d{6}$/);

      const res = await signupVerify(e, code, agent);
      expect(res.status).toBe(201);
      expect(res.body.customer).toMatchObject({
        name: 'Pw Person',
        email: e,
        emailVerified: true,
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

    test('a wrong code is refused and creates nothing; a code works once', async () => {
      const e = email();
      await signupStart(e);
      const code = lastCodeFor(e)!;
      const bad = await signupVerify(e, wrongCode(code));
      expect(bad.status).toBe(400);
      expect(bad.headers['set-cookie']).toBeUndefined();
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(0);
      expect((await signupVerify(e, code)).status).toBe(201);
      expect((await signupVerify(e, code)).status).toBe(400); // used up
      expect((await login(e, PASSWORD)).status).toBe(200);
    });

    test('a code for one address does not work for another, and a malformed code is rejected', async () => {
      const a = email();
      const b = email();
      await signupStart(a);
      await signupStart(b);
      expect((await signupVerify(b, lastCodeFor(a)!)).status).toBe(400);
      expect((await signupVerify(a, '12345')).status).toBe(400);
      expect((await signupVerify(a, 'abcdef')).status).toBe(400);
    });

    test('five wrong guesses use the code up, even for the right answer afterwards', async () => {
      const e = email();
      await signupStart(e);
      const code = lastCodeFor(e)!;
      for (let i = 0; i < 5; i++) expect((await signupVerify(e, wrongCode(code))).status).toBe(400);
      const late = await signupVerify(e, code);
      expect(late.status).toBe(400);
      expect(JSON.stringify(late.body)).toMatch(/Too many attempts/);
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(0);
    });

    test('an expired code is refused', async () => {
      const e = email();
      await signupStart(e);
      await prisma.customerEmailCode.updateMany({ where: { email: e }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await signupVerify(e, lastCodeFor(e)!)).status).toBe(400);
    });

    test('asking again too soon is refused; a new code replaces the old one', async () => {
      const e = email();
      await signupStart(e);
      const first = lastCodeFor(e)!;
      const soon = await signupStart(e);
      expect(soon.status).toBe(429);
      expect(JSON.stringify(soon.body)).toMatch(/Please wait/);

      await ageCodes(e);
      expect((await signupStart(e, { name: 'Second Try' })).status).toBe(200);
      const second = lastCodeFor(e)!;
      if (second !== first) expect((await signupVerify(e, first)).status).toBe(400); // superseded
      const done = await signupVerify(e, second);
      expect(done.status).toBe(201);
      expect(done.body.customer.name).toBe('Second Try'); // the newest details won
    });

    test('only a hash of the code and of the password is stored while sign-up waits', async () => {
      const e = email();
      await signupStart(e, { password: 'very-secret-pw-1' });
      const code = lastCodeFor(e)!;
      const row = await prisma.customerEmailCode.findFirstOrThrow({ where: { email: e } });
      expect(row.codeHash).not.toContain(code);
      expect(JSON.stringify(row)).not.toContain('very-secret-pw-1');
      expect((row.payload as { passwordHash: string }).passwordHash).toMatch(/^scrypt\$/);
    });

    test('rejects a missing name, a bad email, a short password and a bad phone number', async () => {
      expect((await signupStart(email(), { name: '' })).status).toBe(400);
      expect((await signupStart('not-an-email')).status).toBe(400);
      expect((await signupStart(email(), { password: 'short' })).status).toBe(400);
      expect((await signupStart(email(), { password: 'x'.repeat(129) })).status).toBe(400);
      expect((await signupStart(email(), { phone: '12' })).status).toBe(400);
    });

    test('an email that is already registered is refused before any code is sent, whatever its case', async () => {
      const e = email();
      expect((await signup(e)).status).toBe(201);
      const mails = sent.length;
      const again = await signupStart(e.toUpperCase());
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.body)).toMatch(/already registered/);
      expect(sent.length).toBe(mails);
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(1);
    });

    test('someone else registering the address while a sign-up waits wins; the waiting code then fails', async () => {
      const e = email();
      await signupStart(e);
      const code = lastCodeFor(e)!;
      await googleOnly(e); // the real owner signs in with Google first
      const late = await signupVerify(e, code);
      expect(late.status).toBe(409);
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(1);
    });

    test('only the browser that started a sign-up can finish it: another start for the address cannot hijack it', async () => {
      const e = email();
      await signupStart(e, { password: 'victims-own-pw-1' });
      const victimTicket = tickets.get(e)!;
      const victimCode = lastCodeFor(e)!;

      // Someone else asks for a code for the same address (after the cooldown) with their own password.
      await ageCodes(e);
      const attackerStart = await signupStart(e, { name: 'Attacker', password: 'attackers-pw-1' });
      expect(attackerStart.status).toBe(200);
      const attackerTicket = tickets.get(e)!;
      const newCode = lastCodeFor(e)!;
      expect(attackerTicket).not.toBe(victimTicket);

      // The victim's browser holds the old ticket: the new code does not work with it, and nothing is burned.
      expect((await signupVerify(e, newCode, agentFor(app), victimTicket)).status).toBe(400);
      expect((await signupVerify(e, newCode, agentFor(app), 'x'.repeat(40))).status).toBe(400);
      expect(await prisma.customerProfile.count({ where: { email: e } })).toBe(0);
      // The ticket is required, and the old code died when the new one was issued.
      expect((await agentFor(app).post('/customer-auth/signup/verify').send({ email: e, code: newCode })).status).toBe(400);
      if (victimCode !== newCode) expect((await signupVerify(e, victimCode, agentFor(app), victimTicket)).status).toBe(400);
      // Only the holder of the matching ticket finishes the newest sign-up.
      const done = await signupVerify(e, newCode, agentFor(app), attackerTicket);
      expect(done.status).toBe(201);
      expect(done.body.customer.name).toBe('Attacker');
    });

    test('a name with HTML in it is escaped in the template variables as well as in the html copy', async () => {
      const e = email();
      await signupStart(e, { name: '<img src=x onerror=alert(1)>' });
      const mail = [...sent].reverse().find((m) => m.to === e)!;
      expect(String(mail.template?.variables.NAME)).not.toContain('<');
      expect(mail.html).not.toContain('<img');
    });

    test('the same unverified phone number may be used by two sign-ups; a verified one may not', async () => {
      const p = phone();
      expect((await signup(email(), { phone: p })).status).toBe(201);
      expect((await signup(email(), { phone: p })).status).toBe(201);
      await prisma.customerProfile.updateMany({ where: { whatsappNumber: p }, data: { whatsappNumber: null } });
      await prisma.customerProfile.create({ data: { whatsappNumber: p, phoneVerified: true } });
      const taken = await signupStart(email(), { phone: p });
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
    test('the answer is identical for a known, an unknown and a blocked address, and only the real one gets a code', async () => {
      const e = email();
      await signup(e);
      const blockedEmail = email();
      const b = await signup(blockedEmail);
      await prisma.customerProfile.update({ where: { id: b.body.customer.id }, data: { status: 'BLOCKED' } });
      const stranger = email();
      const before = sent.length;

      const [known, unknown, blocked] = [await forgot(e), await forgot(stranger), await forgot(blockedEmail)];
      for (const r of [known, unknown, blocked]) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ ok: true });
      }
      const mails = sent.slice(before);
      expect(mails.map((m) => m.to)).toEqual([e]);
      expect(mails[0]!.text).toMatch(/Your code: \d{6}/);
    });

    test('an address can only be emailed once in the cooldown, and a newer code replaces the older one', async () => {
      const e = email();
      await signup(e);
      await forgot(e);
      const first = lastCodeFor(e)!;
      const mailsBefore = sent.filter((m) => m.to === e).length;
      await forgot(e);
      await forgot(e);
      expect(sent.filter((m) => m.to === e).length).toBe(mailsBefore); // no flood

      await ageCodes(e);
      await forgot(e);
      const second = lastCodeFor(e)!;
      if (second !== first) expect((await reset(e, first, 'new-password-1')).status).toBe(400); // superseded
      expect((await reset(e, second, 'new-password-1')).status).toBe(200);
    });

    test('the code sets the password once, verifies the email, signs every session out and cannot be reused', async () => {
      const e = email();
      const agent = agentFor(app);
      const created = await signup(e, { name: 'Reset Me' }, agent);
      expect(created.status).toBe(201);
      await forgot(e);
      const code = lastCodeFor(e)!;

      expect((await reset(e, code, 'short')).status).toBe(400);
      expect((await reset(e, wrongCode(code), 'new-password-1')).status).toBe(400);
      const ok = await reset(e, code, 'new-password-1');
      expect(ok.status).toBe(200);
      expect(ok.headers['set-cookie']).toBeUndefined(); // setting a password does not sign anyone in

      expect((await rowByEmail(e)).emailVerified).toBe(true);
      expect((await agent.get('/customer-auth/me')).status).toBe(401); // the old session was revoked
      expect((await login(e, PASSWORD)).status).toBe(401);
      expect((await login(e, 'new-password-1')).status).toBe(200);
      expect((await reset(e, code, 'another-password-2')).status).toBe(400); // single use
    });

    test('a wrong code for an unknown address looks the same as a wrong code for a real one', async () => {
      const e = email();
      await signup(e);
      await forgot(e);
      const real = await reset(e, wrongCode(lastCodeFor(e)!), 'new-password-1');
      const stranger = await reset(email(), '123456', 'new-password-1');
      expect(real.status).toBe(400);
      expect(stranger.status).toBe(400);
      expect(stranger.body).toEqual(real.body);
    });

    test('five wrong guesses use the code up', async () => {
      const e = email();
      await signup(e);
      await forgot(e);
      const code = lastCodeFor(e)!;
      for (let i = 0; i < 5; i++) expect((await reset(e, wrongCode(code), 'new-password-1')).status).toBe(400);
      expect((await reset(e, code, 'new-password-1')).status).toBe(400);
      expect((await login(e, PASSWORD)).status).toBe(200); // the password is unchanged
    });

    test('a code sent to one address cannot reset or verify a different address typed in afterwards', async () => {
      const mine = email();
      const victim = email();
      const agent = agentFor(app);
      await signup(mine, {}, agent);
      const victimAccount = await signup(victim);
      expect(victimAccount.status).toBe(201);
      await forgot(mine);
      const code = lastCodeFor(mine)!;
      expect((await reset(victim, code, 'new-password-1')).status).toBe(400);
      expect((await login(victim, PASSWORD)).status).toBe(200);

      // Changing an unproven profile email does not carry the code over to the new address either.
      const unproven = email();
      await prisma.customerProfile.create({ data: { name: 'Unproven', email: unproven, passwordHash: await hashPassword(PASSWORD), emailVerified: false } });
      const typed = agentFor(app);
      expect((await typed.post('/customer-auth/login').send({ email: unproven, password: PASSWORD })).status).toBe(200);
      await forgot(unproven);
      const unprovenCode = lastCodeFor(unproven)!;
      const fresh = email();
      expect((await typed.patch('/customer-auth/me').send({ email: fresh })).status).toBe(200);
      expect((await reset(fresh, unprovenCode, 'new-password-1')).status).toBe(400);
      expect((await rowByEmail(fresh)).emailVerified).toBe(false);
    });

    test('an expired code is refused', async () => {
      const e = email();
      await signup(e);
      await forgot(e);
      const code = lastCodeFor(e)!;
      await prisma.customerEmailCode.updateMany({ where: { email: e }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const res = await reset(e, code, 'new-password-1');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/incorrect or has expired/);
    });

    test('a code for a customer who has since been blocked is refused', async () => {
      const e = email();
      const customer = await signup(e);
      await forgot(e);
      const code = lastCodeFor(e)!;
      await prisma.customerProfile.update({ where: { id: customer.body.customer.id }, data: { status: 'BLOCKED' } });
      expect((await reset(e, code, 'new-password-1')).status).toBe(400);
    });

    test('a Google-only customer has no password until they use Forgot password', async () => {
      const g = await googleOnly();
      expect((await g.agent.get('/customer-auth/me')).body.hasPassword).toBe(false);
      expect((await login(g.e, PASSWORD)).status).toBe(401);

      await forgot(g.e);
      const code = lastCodeFor(g.e)!;
      expect(code).toBeTruthy();
      expect((await reset(g.e, code, 'google-person-pw')).status).toBe(200);

      const signedIn = await login(g.e, 'google-person-pw');
      expect(signedIn.status).toBe(200);
      expect(signedIn.body.customer).toMatchObject({ id: g.id, hasPassword: true, emailVerified: true });
    });
  });

  describe('Resend template', () => {
    test('every code email carries the template id and the code, name and wording as variables, plus a plain copy', async () => {
      const e = email();
      await signupStart(e);
      const mail = [...sent].reverse().find((m) => m.to === e)!;
      expect(mail.template?.id).toBe('tmpl_test_123');
      expect(mail.template?.variables).toMatchObject({ CODE: lastCodeFor(e), NAME: 'Pw Person', EXPIRES_IN_MINUTES: 10 });
      expect(String(mail.template?.variables.HEADING)).toMatch(/Verify/);
      expect(mail.text).toMatch(/Your code: \d{6}/);

      await forgot(e); // no account yet: nothing is sent
      await signupVerify(e, lastCodeFor(e)!);
      await ageCodes(e);
      await forgot(e);
      const resetMail = [...sent].reverse().find((m) => m.to === e)!;
      expect(String(resetMail.template?.variables.HEADING)).toMatch(/Reset/);
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
      await signup(e, { name: 'Two Devices' }, phoneOne);
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
