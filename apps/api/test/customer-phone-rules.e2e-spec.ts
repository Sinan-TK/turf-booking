import type { INestApplication } from '@nestjs/common';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import {
  agentFor,
  createCustomerFixture,
  createOwnerFixture,
  createVenueFixture,
  futureStart,
  loginAsSuperAdmin,
  prisma,
  uniqueSuffix,
} from './setup/fixtures';
import { CustomersService } from '../src/customers/customers.service';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';

/**
 * Who may hold a phone number. A number VERIFIED on one account can't be used on another; UNVERIFIED numbers may
 * repeat; verifying a number clears it from the other accounts that only had it unverified, and those accounts
 * are asked for a number again.
 */
describe('Customer phone number rules', () => {
  let app: INestApplication;
  let customers: CustomersService;

  const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const nationalOf = (p: string) => p.slice(3);
  const email = () => `p-${uniqueSuffix()}@example.com`;

  /** A Google customer, signed in, with an optional unverified number saved. */
  async function googleCustomer(number?: string) {
    const agent = agentFor(app);
    const res = await agent.post('/customer-auth/google').send({ credential: `test:${email()}|Some Person` });
    expect(res.status).toBe(200);
    if (number) expect((await agent.patch('/customer-auth/me').send({ phone: number })).status).toBe(200);
    return { agent, id: res.body.customer.id as string };
  }
  const rowOf = (id: string) => prisma.customerProfile.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp({ throttle: false });
    customers = app.get(CustomersService);
  });
  afterAll(async () => {
    await app.close();
  });

  test('unverified numbers may repeat across accounts', async () => {
    const p = phone();
    const a = await googleCustomer(p);
    const b = await googleCustomer(p);
    expect((await rowOf(a.id)).whatsappNumber).toBe(p);
    expect((await rowOf(b.id)).whatsappNumber).toBe(p);
    expect((await rowOf(a.id)).phoneVerified).toBe(false);
  });

  test('a number verified on one account cannot be used on any other (409)', async () => {
    const p = phone();
    await customers.findOrCreateByWhatsAppNumber(p); // verified holder
    const other = await googleCustomer();
    const res = await other.agent.patch('/customer-auth/me').send({ phone: nationalOf(p) });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/already registered to another account/);
    expect((await rowOf(other.id)).whatsappNumber).toBeNull();

    // The same when starting a sign-up.
    const signup = await agentFor(app)
      .post('/customer-auth/signup')
      .send({ name: 'Taker', email: email(), phone: p, password: 'a-long-password' });
    expect(signup.status).toBe(409);
  });

  test('the squatting case: someone saves your number unverified; when you verify it you get it and they lose it', async () => {
    const p = phone();
    const squatter = await googleCustomer(p);

    // The real owner of the number logs in with a code (the phone-code flow marks it verified).
    const owner = await customers.findOrCreateByWhatsAppNumber(p);
    expect(owner.id).not.toBe(squatter.id);
    expect(owner).toMatchObject({ whatsappNumber: p, phoneVerified: true });

    const cleared = await rowOf(squatter.id);
    expect(cleared.whatsappNumber).toBeNull();
    expect(cleared.phoneVerified).toBe(false);
    expect(cleared.googleSub).not.toBeNull(); // the account itself is untouched

    // Their session still works, and they are asked for a number again.
    const me = await squatter.agent.get('/customer-auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ phone: null, needsProfile: true });

    // The clearing is recorded.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PHONE_UNVERIFIED_CLEARED', entityId: owner.id } });
    expect((audit?.metadata as { cleared: number }).cleared).toBe(1);
  });

  test('every other unverified holder is cleared, and an account with a different number is untouched', async () => {
    const p = phone();
    const q = phone();
    const holders = [await googleCustomer(p), await googleCustomer(p), await googleCustomer(p)];
    const bystander = await googleCustomer(q);
    const owner = await customers.findOrCreateByWhatsAppNumber(p);
    for (const h of holders) expect((await rowOf(h.id)).whatsappNumber).toBeNull();
    expect((await rowOf(bystander.id)).whatsappNumber).toBe(q);
    expect((await rowOf(owner.id)).phoneVerified).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PHONE_UNVERIFIED_CLEARED', entityId: owner.id } });
    expect((audit?.metadata as { cleared: number }).cleared).toBe(3);
  });

  test('logging in again with an already verified number clears nothing more', async () => {
    const p = phone();
    const first = await customers.findOrCreateByWhatsAppNumber(p);
    const late = await googleCustomer(); // tries to save the same number afterwards: refused, so nothing to clear
    expect((await late.agent.patch('/customer-auth/me').send({ phone: p })).status).toBe(409);
    expect((await rowOf(late.id)).whatsappNumber).toBeNull();
    const again = await customers.findOrCreateByWhatsAppNumber(p);
    expect(again.id).toBe(first.id);
    expect(await prisma.auditLog.count({ where: { action: 'PHONE_UNVERIFIED_CLEARED', entityId: first.id } })).toBe(0);
  });

  test('a walk-in recorded by venue staff is adopted (history kept) when the real person verifies the number', async () => {
    const p = phone();
    const guest = await customers.findOrCreateGuestByPhone(p);
    expect(guest.phoneVerified).toBe(false);
    expect((await customers.findOrCreateGuestByPhone(p)).id).toBe(guest.id); // staff typing it again finds the same guest

    const credentialed = await googleCustomer(p); // someone else also typed this number
    const owner = await customers.findOrCreateByWhatsAppNumber(p);
    expect(owner.id).toBe(guest.id); // the credential-less guest becomes theirs
    expect((await rowOf(guest.id)).phoneVerified).toBe(true);
    expect((await rowOf(credentialed.id)).whatsappNumber).toBeNull(); // the account with credentials loses the number
  });

  test('a guest recorded for a number someone has verified is that someone', async () => {
    const p = phone();
    const owner = await customers.findOrCreateByWhatsAppNumber(p);
    expect((await customers.findOrCreateGuestByPhone(p)).id).toBe(owner.id);
  });

  test('simultaneous first logins for one new number end with exactly one verified holder', async () => {
    const p = phone();
    const results = await Promise.all(Array.from({ length: 6 }, () => customers.findOrCreateByWhatsAppNumber(p)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await prisma.customerProfile.count({ where: { whatsappNumber: p, phoneVerified: true } })).toBe(1);
    expect(await prisma.customerProfile.count({ where: { whatsappNumber: p } })).toBe(1);
  });

  test('verifying a number another account already has verified is refused, not merged', async () => {
    const p = phone();
    const holder = await customers.findOrCreateByWhatsAppNumber(p);
    const other = await googleCustomer();
    await expect(customers.markPhoneVerified(other.id, p)).rejects.toMatchObject({ status: 409 });
    expect((await rowOf(holder.id)).phoneVerified).toBe(true);
    expect((await rowOf(other.id)).phoneVerified).toBe(false);
  });

  test('a verified number is the customer\'s identity and cannot be edited away', async () => {
    const p = phone();
    const { agent, customerId } = await createCustomerFixture(app); // verified by construction
    expect(customerId).toBeTruthy();
    const me = await agent.get('/customer-auth/me');
    expect(me.body.phoneVerified).toBe(true);
    const res = await agent.patch('/customer-auth/me').send({ phone: p });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/verified/);
    // Sending the same number it already has is harmless.
    expect((await agent.patch('/customer-auth/me').send({ phone: me.body.phone })).status).toBe(200);
  });

  describe('messages go only to verified numbers', () => {
    test('a booking confirmation is sent to a verified number and not to an unverified one', async () => {
      const messenger = app.get<FakeCustomerMessenger>(CUSTOMER_MESSENGER);
      const admin = await loginAsSuperAdmin(app);
      const { ownerAgent } = await createOwnerFixture(app, admin);
      const venue = await createVenueFixture(app, ownerAgent, admin);

      // Verified customer pays with coins.
      const verified = await createCustomerFixture(app);
      await admin.post('/admin/coins/adjust').send({ customerId: verified.customerId, signedAmount: 2000, reason: 'E2E' });
      const h1 = await verified.agent
        .post('/bookings/hold')
        .send({ resourceId: venue.halfAId, startTime: futureStart(8, 9).toISOString(), durationMinutes: 60 });
      expect(h1.status).toBe(201);
      expect((await verified.agent.post(`/bookings/${h1.body.id}/pay-with-coins`).send({})).status).toBe(201);
      expect(messenger.confirmed.some((m) => m.orderId === h1.body.orderId && m.phone === verified.whatsappNumber)).toBe(true);

      // Unverified (Google, typed phone) customer pays with coins.
      const typed = await googleCustomer(phone());
      await admin.post('/admin/coins/adjust').send({ customerId: typed.id, signedAmount: 2000, reason: 'E2E' });
      const h2 = await typed.agent
        .post('/bookings/hold')
        .send({ resourceId: venue.halfBId, startTime: futureStart(8, 10).toISOString(), durationMinutes: 60 });
      expect(h2.status).toBe(201);
      expect((await typed.agent.post(`/bookings/${h2.body.id}/pay-with-coins`).send({})).status).toBe(201);
      expect(messenger.confirmed.some((m) => m.orderId === h2.body.orderId)).toBe(false);

      // Cancelling does not message them either.
      expect((await typed.agent.post(`/me/bookings/${h2.body.id}/cancel`).send({})).status).toBe(201);
      expect(messenger.cancelled.some((m) => m.orderId === h2.body.orderId)).toBe(false);
    });
  });
});
