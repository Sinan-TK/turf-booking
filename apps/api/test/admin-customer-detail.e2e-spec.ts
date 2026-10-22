import type { INestApplication } from '@nestjs/common';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';
import { CustomerOtpService } from '../src/auth/customer-otp.service';
import { CustomerSessionService } from '../src/auth/customer-session.service';
import { loginAsSuperAdmin, prisma, type TestAgent } from './setup/fixtures';

describe('admin customer detail and blocking', () => {
  let app: INestApplication;
  let admin: TestAgent;
  const phone = `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  let customerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    const otp = app.get(CustomerOtpService);
    const messenger = app.get<FakeCustomerMessenger>(CUSTOMER_MESSENGER);
    await otp.requestCode(phone);
    const res = await otp.verifyCode(phone, messenger.lastCodeFor(phone)!);
    customerId = res.customer.id;
  });
  afterAll(async () => app.close());

  it('returns activity stats for a customer with no bookings', async () => {
    const res = await admin.get(`/admin/customers/${customerId}`).expect(200);
    expect(res.body.stats).toMatchObject({ totalBookings: 0, totalSpent: '0', lastBookedAt: null, openTickets: 0 });
    expect(res.body.recentBookings).toEqual([]);
    expect(res.body.recentTransactions).toEqual([]);
  });

  it('blocking revokes live sessions, refuses new logins, and unblocking restores access', async () => {
    const sessions = app.get(CustomerSessionService);
    const { rawToken } = await sessions.createSession(customerId, 'LOGIN');
    expect(await sessions.validateSession(rawToken)).not.toBeNull();

    const blocked = await admin.patch(`/admin/customers/${customerId}/status`).send({ status: 'BLOCKED', reason: 'abuse' }).expect(200);
    expect(blocked.body.status).toBe('BLOCKED');
    expect(await sessions.validateSession(rawToken)).toBeNull();

    const otp = app.get(CustomerOtpService);
    const messenger = app.get<FakeCustomerMessenger>(CUSTOMER_MESSENGER);
    await prisma.loginCode.updateMany({ where: { phone }, data: { createdAt: new Date(Date.now() - 120_000) } });
    await otp.requestCode(phone);
    await expect(otp.verifyCode(phone, messenger.lastCodeFor(phone)!)).rejects.toThrow(/blocked/);

    await admin.patch(`/admin/customers/${customerId}/status`).send({ status: 'ACTIVE' }).expect(200);
    const fresh = await sessions.createSession(customerId, 'LOGIN');
    expect(await sessions.validateSession(fresh.rawToken)).not.toBeNull();
  });

  it('rejects an unknown status', async () => {
    await admin.patch(`/admin/customers/${customerId}/status`).send({ status: 'GONE' }).expect(400);
  });
});
