import type { INestApplication } from '@nestjs/common';
import { createTestApp, FakeCustomerMessenger } from './setup/test-app';
import { CUSTOMER_MESSENGER } from '../src/customer-messaging/customer-messenger.port';
import { CustomerOtpService } from '../src/auth/customer-otp.service';
import { prisma } from './setup/fixtures';

describe('CustomerOtpService', () => {
  let app: INestApplication;
  let otp: CustomerOtpService;
  let messenger: FakeCustomerMessenger;
  const phone = () => `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const aged = (p: string) =>
    prisma.loginCode.updateMany({ where: { phone: p }, data: { createdAt: new Date(Date.now() - 120_000) } });

  beforeAll(async () => {
    app = await createTestApp();
    otp = app.get(CustomerOtpService);
    messenger = app.get(CUSTOMER_MESSENGER);
  });
  afterAll(async () => app.close());

  it('issues a 6-digit code and logs a customer in with it', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    expect(code).toMatch(/^\d{6}$/);
    const res = await otp.verifyCode(p, code);
    expect(res.customer.phone).toBe(p);
    expect(res.needsName).toBe(true);
    expect(res.rawToken.length).toBeGreaterThan(20);
  });

  it('never stores the code in plain text', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    const row = await prisma.loginCode.findFirstOrThrow({ where: { phone: p } });
    expect(row.codeHash).not.toContain(code);
  });

  it('rejects a wrong code and locks the code after 5 attempts', async () => {
    const p = phone();
    await otp.requestCode(p);
    const good = messenger.lastCodeFor(p)!;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(otp.verifyCode(p, bad)).rejects.toThrow();
    }
    await expect(otp.verifyCode(p, good)).rejects.toThrow(/Too many attempts|Invalid or expired/);
  });

  it('is single use', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    await otp.verifyCode(p, code);
    await expect(otp.verifyCode(p, code)).rejects.toThrow();
  });

  it('rejects an expired code', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    await prisma.loginCode.updateMany({ where: { phone: p }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(otp.verifyCode(p, code)).rejects.toThrow();
  });

  it('only the newest code works when a second is requested', async () => {
    const p = phone();
    await otp.requestCode(p);
    const first = messenger.lastCodeFor(p)!;
    await aged(p);
    await otp.requestCode(p);
    const second = messenger.lastCodeFor(p)!;
    if (first !== second) await expect(otp.verifyCode(p, first)).rejects.toThrow();
    await expect(otp.verifyCode(p, second)).resolves.toBeDefined();
  });

  it('enforces the resend cooldown', async () => {
    const p = phone();
    await otp.requestCode(p);
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 429 });
  });

  it('caps codes per phone per hour', async () => {
    const p = phone();
    for (let i = 0; i < 5; i++) {
      await otp.requestCode(p);
      await aged(p);
    }
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 429 });
  });

  it('returns 503 and leaves no usable code when sending fails', async () => {
    const p = phone();
    messenger.failNext = true;
    await expect(otp.requestCode(p)).rejects.toMatchObject({ status: 503 });
    const live = await prisma.loginCode.count({ where: { phone: p, consumedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects malformed phones with 400', async () => {
    await expect(otp.requestCode('abc')).rejects.toMatchObject({ status: 400 });
  });

  it('two simultaneous verifies of one code create exactly one session', async () => {
    const p = phone();
    await otp.requestCode(p);
    const code = messenger.lastCodeFor(p)!;
    const results = await Promise.allSettled([otp.verifyCode(p, code), otp.verifyCode(p, code)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('reuses the same customer for different spellings of one phone', async () => {
    const digits = `98${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const canonical = `+91${digits}`;
    await otp.requestCode(digits);
    const a = await otp.verifyCode(digits, messenger.lastCodeFor(canonical)!);
    await aged(canonical);
    await otp.requestCode(`+91 ${digits}`);
    const b = await otp.verifyCode(`+91 ${digits}`, messenger.lastCodeFor(canonical)!);
    expect(b.customer.id).toBe(a.customer.id);
  });
});
