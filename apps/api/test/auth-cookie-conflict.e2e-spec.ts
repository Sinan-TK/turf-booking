import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnv } from '@venue/config';
import { Role } from '@venue/shared';
import { StaffTokenService } from '../src/identity/staff-token.service';
import { CustomerSessionService } from '../src/auth/customer-session.service';
import { createTestApp } from './setup/test-app';
import { createCustomerFixture, prisma, uniqueSuffix } from './setup/fixtures';

/**
 * Admin, owner and customer sign-ins are all cookies on the one API host (localhost in development, and the API's own
 * host in production), so one browser can carry several at once: a developer signed into the admin portal and the
 * customer site, or an owner who also books as a customer. Each app must be answered as who it is for, judged by the
 * address the request comes from, or customers get "forbidden" and look logged out, and the portals stop refreshing
 * their own expired sign-in.
 */
describe('customer and staff sign-ins in one browser', () => {
  let app: INestApplication;
  const env = loadEnv();
  let customerCookie: string;
  let validAdminCookie: string;
  const brokenAdminCookie = 'admin_access=expired.or.invalid';

  const as = (origin: string | undefined, cookies: string[], path: string) => {
    const req = request(app.getHttpServer()).get(path).set('Cookie', cookies.join('; '));
    return origin ? req.set('Origin', origin) : req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    const { customerId } = await createCustomerFixture(app);
    const { rawToken } = await app.get(CustomerSessionService).createSession(customerId, 'BOOKING');
    customerCookie = `customer_session=${rawToken}`;
    const admin = await prisma.adminUser.create({
      data: { email: `e2e-cookie-${uniqueSuffix()}@example.com`, name: 'Cookie Admin', role: 'SUPER_ADMIN' },
    });
    validAdminCookie = `admin_access=${await app.get(StaffTokenService).signAccessToken({ role: Role.SUPER_ADMIN, id: admin.id })}`;
  });
  afterAll(async () => app.close());

  it('the customer site is answered as the customer even while an admin sign-in is valid in the same browser', async () => {
    const cookies = [customerCookie, validAdminCookie];
    expect((await as(env.WEB_APP_URL, cookies, '/customer-auth/me')).status).toBe(200);
    expect((await as(env.WEB_APP_URL, cookies, '/me/coins')).status).toBe(200);
    expect((await as(env.WEB_APP_URL, cookies, '/me/coins/transactions')).status).toBe(200);
  });

  it('the admin portal is answered as the admin, and never as the customer', async () => {
    const cookies = [customerCookie, validAdminCookie];
    expect((await as(env.ADMIN_APP_URL, cookies, '/admin/categories')).status).toBe(200);
    // A customer cookie must not stand in for a missing or expired admin sign-in: 401 is what makes the portal sign in again.
    expect((await as(env.ADMIN_APP_URL, [customerCookie, brokenAdminCookie], '/admin/categories')).status).toBe(401);
    expect((await as(env.ADMIN_APP_URL, [customerCookie], '/admin/categories')).status).toBe(401);
  });

  it('the owner portal is not answered as the customer either', async () => {
    expect((await as(env.OWNER_APP_URL, [customerCookie], '/resources?venueId=00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });

  it('a customer who is simply logged out of the customer site gets 401, whatever staff cookies are present', async () => {
    expect((await as(env.WEB_APP_URL, [validAdminCookie], '/customer-auth/me')).status).toBe(401);
    expect((await as(env.WEB_APP_URL, [], '/me/coins')).status).toBe(401);
  });

  it('with no origin at all (tools, scripts) nothing changes: staff cookie first, then the customer cookie', async () => {
    expect((await as(undefined, [customerCookie], '/customer-auth/me')).status).toBe(200);
    expect((await as(undefined, [validAdminCookie], '/admin/categories')).status).toBe(200);
  });
});
