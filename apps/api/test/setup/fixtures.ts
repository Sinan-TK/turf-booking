import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { prisma } from '@venue/database';
import { Role } from '@venue/shared';
import { StaffTokenService } from '../../src/identity/staff-token.service';
import { CustomersService } from '../../src/customers/customers.service';
import { CustomerSessionService } from '../../src/auth/customer-session.service';
import { CUSTOMER_SESSION_COOKIE } from '../../src/auth/auth.constants';

/** The subset of supertest's Agent interface every fixture helper
 * actually uses — satisfied both by a real `request.agent(...)` (whose
 * cookie jar is populated by a real login response) and by
 * `cookieAgent` below (whose "jar" is a single fixed cookie header, for
 * a customer session minted directly through the service layer). */
export type TestAgent = Pick<request.Agent, 'get' | 'post' | 'patch' | 'put' | 'delete'>;

export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

/** `Date.now() + daysFromNow`, at a fixed hour — always a valid future
 * timestamp for CreateHoldDto, and stable/predictable within a single test
 * rather than depending on exactly when `new Date()` is evaluated relative
 * to "now". Aligned to `hour` in the fixture venue's own timezone
 * (Asia/Kolkata, see createVenueFixture below) — not UTC — since bookings
 * must now start exactly on the hour in the venue's LOCAL time
 * (now enforced per venue by BookingPolicy, see scheduling/policy-validation.ts),
 * and Asia/Kolkata's UTC+5:30 offset means a UTC-aligned hour lands on the
 * half-hour locally. */
export function futureStart(daysFromNow: number, hour: number): Date {
  return DateTime.now()
    .setZone('Asia/Kolkata')
    .plus({ days: daysFromNow })
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .toJSDate();
}

export function agentFor(app: INestApplication): TestAgent {
  return request.agent(app.getHttpServer());
}

/** A `TestAgent` that always sends a fixed header — for a customer
 * session minted directly through the service layer (`Cookie`), or for
 * an admin/owner with a directly minted access token (`Authorization:
 * Bearer <access token>`; AuthGuard accepts it alongside the portals'
 * real httpOnly cookies). */
function headerAgent(app: INestApplication, header: string, value: string): TestAgent {
  const http = app.getHttpServer();
  return {
    get: (path: string) => request(http).get(path).set(header, value),
    post: (path: string) => request(http).post(path).set(header, value),
    patch: (path: string) => request(http).patch(path).set(header, value),
    put: (path: string) => request(http).put(path).set(header, value),
    delete: (path: string) => request(http).delete(path).set(header, value),
  } as TestAgent;
}

function cookieAgent(app: INestApplication, cookieHeader: string): TestAgent {
  return headerAgent(app, 'Cookie', cookieHeader);
}

function bearerAgent(app: INestApplication, accessToken: string): TestAgent {
  return headerAgent(app, 'Authorization', `Bearer ${accessToken}`);
}

/**
 * Mints a bearer-authenticated TestAgent for an already-provisioned staff
 * user by signing an access token directly (StaffTokenService) — the same
 * token /auth/{admin,owner}/login issues, minus the HTTP round trip (login
 * is rate-limited, which a suite creating many fixtures would blow
 * through; the login flow itself is covered in staff-auth.e2e-spec.ts).
 */
async function agentForStaffContext(
  app: INestApplication,
  ctx: Parameters<StaffTokenService['signAccessToken']>[0],
): Promise<TestAgent> {
  const accessToken = await app.get(StaffTokenService).signAccessToken(ctx);
  return bearerAgent(app, accessToken);
}

/** A fresh Super Admin identity (no bootstrapping endpoint exists for the
 * very first Super Admin by design, so the row is created directly). */
export async function loginAsSuperAdmin(app: INestApplication) {
  const suffix = uniqueSuffix();
  const adminUser = await prisma.adminUser.create({
    data: {
      email: `e2e-admin-${suffix}@example.com`,
      name: `E2E Admin ${suffix}`,
      role: 'SUPER_ADMIN',
    },
  });
  return agentForStaffContext(app, { role: Role.SUPER_ADMIN, id: adminUser.id });
}

/** A fresh OwnerOrganization + OWNER_ADMIN, created through the real
 * admin-provisioning API for the organization; the owner user row is
 * inserted directly (real invitees set a password via an emailed link a
 * test can't click), then given a session token. */
export async function createOwnerFixture(app: INestApplication, adminAgent: TestAgent) {
  const suffix = uniqueSuffix();
  const orgRes = await adminAgent.post('/admin/organizations').send({
    name: `E2E Org ${suffix}`,
    contactEmail: `e2e-org-${suffix}@example.com`,
    contactPhone: '+919999900000',
  });
  if (orgRes.status !== 201) {
    throw new Error(`Organization creation failed: ${orgRes.status} ${JSON.stringify(orgRes.body)}`);
  }
  const organizationId = orgRes.body.id as string;

  const email = `e2e-owner-${suffix}@example.com`;
  const ownerUser = await prisma.venueOwnerUser.create({
    data: { organizationId, email, name: `E2E Owner ${suffix}`, role: 'OWNER_ADMIN' },
  });

  const ownerAgent = await agentForStaffContext(app, {
    role: Role.VENUE_OWNER,
    id: ownerUser.id,
    organizationId,
    ownerRole: 'OWNER_ADMIN',
  });
  return { organizationId, ownerAgent, ownerEmail: email };
}

interface VenueFixture {
  venueId: string;
  fullGroundId: string;
  halfAId: string;
  halfBId: string;
}

/**
 * A fully bookable venue: 7s Full Ground composed of 5s Half A + 5s Half
 * B (the exact composition the brief's conflict rule is about),
 * WEEKDAY/WEEKEND pricing for a 60-minute slot on all three resources,
 * and wide-open (00:00-23:59) operating hours every day — set up
 * entirely through the real owner-facing API (resource creation,
 * composition linking, VenueConfigModule from Phase 10), then activated
 * by the Super Admin (owners can't self-activate — VenuesService
 * .OWNER_ALLOWED_STATUSES).
 */
export async function createVenueFixture(
  app: INestApplication,
  ownerAgent: TestAgent,
  adminAgent: TestAgent,
  options: { categoryId?: string } = {},
): Promise<VenueFixture> {
  const statesRes = await request(app.getHttpServer()).get('/states');
  const stateId = statesRes.body[0]?.id;
  if (!stateId) throw new Error('No seeded state found — is the dev DB migrated and seeded?');
  const districtsRes = await request(app.getHttpServer()).get(`/districts?stateId=${stateId}`);
  const districtId = districtsRes.body[0]?.id;
  if (!districtId) throw new Error('No seeded district found for the first state');

  const suffix = uniqueSuffix();
  const venueRes = await ownerAgent.post('/venues').send({
    name: `E2E Venue ${suffix}`,
    districtId,
    address: '1 Test Lane',
    lat: 10,
    lng: 76,
    timezone: 'Asia/Kolkata',
    defaultSlotGranularityMinutes: 30,
    ...(options.categoryId ? { categoryId: options.categoryId } : {}),
  });
  if (venueRes.status !== 201) {
    throw new Error(`Venue creation failed: ${venueRes.status} ${JSON.stringify(venueRes.body)}`);
  }
  const venueId = venueRes.body.id as string;

  const activateRes = await adminAgent.patch(`/venues/${venueId}`).send({ status: 'ACTIVE' });
  if (activateRes.status !== 200) {
    throw new Error(`Venue activation failed: ${activateRes.status} ${JSON.stringify(activateRes.body)}`);
  }

  async function createResource(name: string, groundType: string, sortOrder: number) {
    const res = await ownerAgent
      .post('/resources')
      .send({ venueId, name, groundType, isBookable: true, sortOrder });
    if (res.status !== 201) {
      throw new Error(`Resource creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.id as string;
  }

  const fullGroundId = await createResource('7s Full Ground', '7S', 0);
  const halfAId = await createResource('5s Half A', '5S', 1);
  const halfBId = await createResource('5s Half B', '5S', 2);

  for (const childResourceId of [halfAId, halfBId]) {
    const res = await ownerAgent
      .post('/resources/compositions')
      .send({ parentResourceId: fullGroundId, childResourceId });
    if (res.status !== 201) {
      throw new Error(`Composition creation failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  for (const resourceId of [fullGroundId, halfAId, halfBId]) {
    for (const dayType of ['WEEKDAY', 'WEEKEND']) {
      const res = await ownerAgent
        .post('/resources/pricing-rules')
        .send({ resourceId, durationMinutes: 60, dayType, price: 800, currency: 'INR' });
      if (res.status !== 201) {
        throw new Error(`Pricing rule creation failed: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
  }

  for (let weekday = 0; weekday <= 6; weekday++) {
    const res = await ownerAgent
      .put('/venue-config/operating-hours')
      .send({ venueId, weekday, openTime: '00:00', closeTime: '23:59' });
    if (res.status !== 200) {
      throw new Error(`Operating hours upsert failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  return { venueId, fullGroundId, halfAId, halfBId };
}

/**
 * A fresh customer, identified only by a randomly generated WhatsApp
 * number — matches the real identity model (CustomersService
 * .findOrCreateByWhatsAppNumber: created on first contact, no signup
 * step) rather than inserting a CustomerProfile row directly.
 *
 * Mints the session through CustomersService/CustomerSessionService
 * directly (the same services `POST /booking-sessions` itself calls)
 * rather than going through that HTTP endpoint — it's rate-limited to
 * 10/min (`@Throttle`), which a suite creating many customer fixtures
 * per test file blows through in seconds. Bypassing it here isn't a
 * hack around something under test: that endpoint is explicitly a
 * "TEMPORARY entry point" (see its own doc comment) standing in for the
 * real WhatsApp-webhook-driven session creation, which is what this
 * mirrors instead.
 */
export async function createCustomerFixture(app: INestApplication) {
  const whatsappNumber = `+9199${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const customersService = app.get(CustomersService);
  const sessionService = app.get(CustomerSessionService);

  const customer = await customersService.findOrCreateByWhatsAppNumber(whatsappNumber);
  const { rawToken } = await sessionService.createSession(customer.id, 'BOOKING');

  const agent = cookieAgent(app, `${CUSTOMER_SESSION_COOKIE}=${rawToken}`);
  return { agent, whatsappNumber, customerId: customer.id };
}

export { prisma };
