import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup/test-app';
import {
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
} from './setup/fixtures';
import { MailService, type MailMessage } from '../src/identity/mail.service';

/**
 * Booking needs a verified way to reach the customer: a verified email or a verified phone. The profile's Verify
 * button proves an email with an emailed code.
 */
describe('contact verification before booking', () => {
  let app: INestApplication;
  let resourceId: string;
  const sent: MailMessage[] = [];
  let day = 5;
  const holdBody = () => ({ resourceId, startTime: futureStart(day++, 9).toISOString(), durationMinutes: 60 });
  const lastCode = (to: string) => {
    const mail = [...sent].reverse().find((m) => m.to === to);
    return mail && /Your code: (\d{6})/.exec(mail.text)?.[1];
  };

  /** A signed-in customer whose email and phone are both unproven. */
  async function unverifiedCustomer(email?: string) {
    const fixture = await createCustomerFixture(app);
    await prisma.customerProfile.update({
      where: { id: fixture.customerId },
      data: { phoneVerified: false, emailVerified: false, email: email ?? null, name: 'Unproven' },
    });
    return fixture;
  }

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    jest.spyOn(app.get(MailService, { strict: false }), 'send').mockImplementation(async (m) => {
      sent.push(m);
      return true;
    });
    const admin = await loginAsSuperAdmin(app);
    const owner = (await createOwnerFixture(app, admin)).ownerAgent;
    resourceId = (await createVenueFixture(app, owner, admin)).fullGroundId;
  });
  afterAll(async () => app.close());

  it('refuses to hold a slot while neither the email nor the phone is verified', async () => {
    const { agent, customerId } = await unverifiedCustomer(`unproven-${uniqueSuffix()}@example.com`);
    const res = await agent.post('/bookings/hold').send(holdBody());
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'CONTACT_NOT_VERIFIED' });
    expect(await prisma.slotHold.count({ where: { customerId } })).toBe(0);
  });

  it('allows it with a verified phone alone, or a verified email alone', async () => {
    const phoneOnly = await createCustomerFixture(app); // a verified phone, no email
    expect((await phoneOnly.agent.post('/bookings/hold').send(holdBody())).status).toBe(201);

    const emailOnly = await unverifiedCustomer(`email-only-${uniqueSuffix()}@example.com`);
    await prisma.customerProfile.update({ where: { id: emailOnly.customerId }, data: { emailVerified: true } });
    expect((await emailOnly.agent.post('/bookings/hold').send(holdBody())).status).toBe(201);
  });

  it('the Verify button proves the email with an emailed code, and then booking works', async () => {
    const email = `verify-me-${uniqueSuffix()}@example.com`;
    const { agent, customerId } = await unverifiedCustomer(email);
    expect((await agent.post('/bookings/hold').send(holdBody())).status).toBe(403);

    const send = await agent.post('/customer-auth/email/send-code');
    expect(send.status).toBe(200);
    const code = lastCode(email)!;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await agent.post('/customer-auth/email/verify').send({ code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).emailVerified).toBe(false);

    const ok = await agent.post('/customer-auth/email/verify').send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ email, emailVerified: true });
    expect((await agent.post('/bookings/hold').send(holdBody())).status).toBe(201);
    expect((await agent.post('/customer-auth/email/verify').send({ code })).status).toBe(200); // already verified: harmless
  });

  it('a code sent to one address does not verify another typed in afterwards', async () => {
    const first = `first-${uniqueSuffix()}@example.com`;
    const { agent, customerId } = await unverifiedCustomer(first);
    await agent.post('/customer-auth/email/send-code').expect(200);
    const code = lastCode(first)!;
    const second = `second-${uniqueSuffix()}@example.com`;
    await agent.patch('/customer-auth/me').send({ email: second }).expect(200);
    expect((await agent.post('/customer-auth/email/verify').send({ code })).status).toBe(400);
    expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: customerId } })).emailVerified).toBe(false);
  });

  it('has nothing to verify without an email, or when it is already verified; needs a signed-in customer', async () => {
    const noEmail = await unverifiedCustomer();
    expect((await noEmail.agent.post('/customer-auth/email/send-code')).status).toBe(400);
    const already = await unverifiedCustomer(`already-${uniqueSuffix()}@example.com`);
    await prisma.customerProfile.update({ where: { id: already.customerId }, data: { emailVerified: true } });
    expect((await already.agent.post('/customer-auth/email/send-code')).status).toBe(400);
    const { agentFor } = await import('./setup/fixtures');
    expect((await agentFor(app).post('/customer-auth/email/send-code')).status).toBe(401);
  });
});
