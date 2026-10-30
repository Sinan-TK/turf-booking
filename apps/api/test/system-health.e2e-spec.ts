import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, createOwnerFixture, loginAsSuperAdmin, type TestAgent } from './setup/fixtures';

/** The API health: a public probe, and a Super Admin view with safe, per-part details. */
describe('System health', () => {
  let app: INestApplication;
  let admin: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  test('the public probe says ok with a timestamp', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
  });

  test('the Super Admin sees each check, when it was made and the uptime, and nothing sensitive', async () => {
    const res = await admin.get('/admin/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(new Date(res.body.checkedAt).getTime()).not.toBeNaN();
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.checks).toEqual([expect.objectContaining({ name: 'Database', status: 'ok', latencyMs: expect.any(Number), message: expect.any(String) })]);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/postgres(ql)?:\/\/|password|secret|DATABASE_URL|neon\.tech|localhost/i);
  });

  test('owners, customers and signed-out visitors are refused', async () => {
    const { ownerAgent } = await createOwnerFixture(app, admin);
    expect([401, 403]).toContain((await ownerAgent.get('/admin/system/health')).status);
    const { agent } = await createCustomerFixture(app);
    expect([401, 403]).toContain((await agent.get('/admin/system/health')).status);
    expect((await request(app.getHttpServer()).get('/admin/system/health')).status).toBe(401);
  });

  test('when the database does not answer, the details say so in plain words and the public probe returns 503', async () => {
    const { PrismaService } = await import('../src/prisma/prisma.service');
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma.client, '$queryRaw').mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432 password=hunter2'));
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const pub = await request(app.getHttpServer()).get('/health');
      expect(pub.status).toBe(503);
      expect(pub.body.status).toBe('down');
      expect(JSON.stringify(pub.body)).not.toMatch(/hunter2|10\.1\.2\.3/);

      const { HealthService } = await import('../src/health/health.service');
      const details = await app.get(HealthService).details();
      expect(details.status).toBe('degraded');
      expect(details.checks[0]).toMatchObject({ name: 'Database', status: 'down' });
      expect(JSON.stringify(details)).not.toMatch(/hunter2|10\.1\.2\.3|ECONNREFUSED/);
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });
});
