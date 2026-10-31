import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, loginAsSuperAdmin, prisma, uniqueSuffix, type TestAgent } from './setup/fixtures';

/** The Super Admin manages states (with their codes), districts and areas; customers see only what is switched on. */
describe('Locations managed by the Super Admin', () => {
  let app: INestApplication;
  let admin: TestAgent;
  let countryId: string;
  const tag = uniqueSuffix().replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase();
  const created = { states: [] as string[], districts: [] as string[] };
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsSuperAdmin(app);
    countryId = (await http().get('/countries').expect(200)).body[0].id;
  });

  afterAll(async () => {
    await prisma.area.deleteMany({ where: { districtId: { in: created.districts } } });
    await prisma.facilityCodeSequence.deleteMany({ where: { districtId: { in: created.districts } } });
    await prisma.district.deleteMany({ where: { id: { in: created.districts } } });
    await prisma.state.deleteMany({ where: { id: { in: created.states } } });
    await app.close();
  });

  it('adds a state with its code, a district with its code and timezone, and an area with a centre', async () => {
    const state = await admin.post('/admin/states').send({ countryId, name: `E2E State ${tag}`, code: `s${tag}` }).expect(201);
    created.states.push(state.body.id);
    expect(state.body.code).toBe(`S${tag}`); // codes are upper-cased
    const district = await admin.post('/admin/districts').send({ stateId: state.body.id, name: `E2E District ${tag}`, code: `D${tag}`, timezone: 'Asia/Kolkata' }).expect(201);
    created.districts.push(district.body.id);
    const area = await admin.post('/admin/areas').send({ districtId: district.body.id, name: `E2E Area ${tag}`, lat: 12.5, lng: 77.5 }).expect(201);
    expect(area.body).toMatchObject({ lat: 12.5, lng: 77.5 });
  });

  it('a name or code that is already taken is a clear 409, not a server error', async () => {
    const stateId = created.states[0]!;
    expect((await admin.post('/admin/states').send({ countryId, name: `E2E State ${tag}`, code: `X${tag}` })).status).toBe(409);
    expect((await admin.post('/admin/states').send({ countryId, name: `E2E Other ${tag}`, code: `S${tag}` })).status).toBe(409);
    expect((await admin.post('/admin/districts').send({ stateId, name: `E2E District ${tag}`, code: `Z${tag}`, timezone: 'Asia/Kolkata' })).status).toBe(409);
    const dup = await admin.post('/admin/areas').send({ districtId: created.districts[0], name: `E2E Area ${tag}` });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already exists/);
    expect((await admin.post('/admin/districts').send({ stateId: '11111111-1111-4111-8111-111111111111', name: 'x', code: 'X', timezone: 'Asia/Kolkata' })).status).toBe(404);
  });

  it('the new place appears in the customer places list as area, district and state', async () => {
    const places = (await http().get('/places').expect(200)).body as Array<{ name: string; districtName: string; stateName: string; lat: number | null }>;
    const mine = places.find((p) => p.name === `E2E Area ${tag}`);
    expect(mine).toMatchObject({ districtName: `E2E District ${tag}`, stateName: `E2E State ${tag}`, lat: 12.5 });
    // Places in other states are listed too (not only Kerala), each with its own state.
    expect(new Set(places.map((p) => p.stateName)).size).toBeGreaterThan(1);
  });

  it('switching an area, district or state off hides it from customers but not from the admin; switching on brings it back', async () => {
    const areaId = (await admin.get(`/admin/areas?districtId=${created.districts[0]}`).expect(200)).body[0].id;
    await admin.patch(`/admin/areas/${areaId}`).send({ status: 'INACTIVE' }).expect(200);
    expect(((await http().get('/places')).body as Array<{ name: string }>).some((p) => p.name === `E2E Area ${tag}`)).toBe(false);
    expect(((await http().get(`/areas?districtId=${created.districts[0]}`)).body as unknown[]).length).toBe(0);
    expect(((await admin.get(`/admin/areas?districtId=${created.districts[0]}`)).body as Array<{ status: string }>)[0]!.status).toBe('INACTIVE');
    await admin.patch(`/admin/areas/${areaId}`).send({ status: 'ACTIVE' }).expect(200);
    expect(((await http().get('/places')).body as Array<{ name: string }>).some((p) => p.name === `E2E Area ${tag}`)).toBe(true);

    // A district off hides its areas and the district; a state off hides its districts and areas.
    await admin.patch(`/admin/districts/${created.districts[0]}`).send({ status: 'INACTIVE' }).expect(200);
    expect(((await http().get('/places')).body as Array<{ name: string }>).some((p) => p.name === `E2E Area ${tag}`)).toBe(false);
    await admin.patch(`/admin/districts/${created.districts[0]}`).send({ status: 'ACTIVE' }).expect(200);
    await admin.patch(`/admin/states/${created.states[0]}`).send({ status: 'INACTIVE' }).expect(200);
    expect(((await http().get('/states')).body as Array<{ id: string }>).some((s) => s.id === created.states[0])).toBe(false);
    expect(((await http().get(`/districts?stateId=${created.states[0]}`)).body as unknown[]).length).toBe(0);
    expect(((await admin.get('/admin/states')).body as Array<{ id: string }>).some((s) => s.id === created.states[0])).toBe(true);
    await admin.patch(`/admin/states/${created.states[0]}`).send({ status: 'ACTIVE' }).expect(200);
  });

  it('renames, moves the centre and clears it; the code cannot be changed', async () => {
    const areaId = (await admin.get(`/admin/areas?districtId=${created.districts[0]}`)).body[0].id as string;
    const renamed = await admin.patch(`/admin/areas/${areaId}`).send({ name: `E2E Area ${tag} B`, lat: 12.6, lng: 77.6 }).expect(200);
    expect(renamed.body).toMatchObject({ name: `E2E Area ${tag} B`, lat: 12.6 });
    const cleared = await admin.patch(`/admin/areas/${areaId}`).send({ lat: null, lng: null }).expect(200);
    expect(cleared.body).toMatchObject({ lat: null, lng: null });
    expect((await admin.patch(`/admin/areas/${areaId}`).send({ lat: 12 })).status).toBe(400); // both or neither
    expect((await admin.patch(`/admin/states/${created.states[0]}`).send({ code: 'NEW' })).status).toBe(400); // nothing editable given
    expect((await admin.patch(`/admin/districts/${created.districts[0]}`).send({ timezone: 'Asia/Dubai' }).expect(200)).body.timezone).toBe('Asia/Dubai');
  });

  it('only the Super Admin can change locations', async () => {
    const { ownerAgent } = await createOwnerFixture(app, admin);
    const body = { countryId, name: `E2E Nope ${tag}`, code: `N${tag}` };
    expect([401, 403]).toContain((await ownerAgent.post('/admin/states').send(body)).status);
    expect([401, 403]).toContain((await ownerAgent.patch(`/admin/states/${created.states[0]}`).send({ status: 'INACTIVE' })).status);
    expect([401, 403]).toContain((await ownerAgent.get('/admin/states')).status);
    expect((await http().post('/admin/states').send(body)).status).toBe(401);
  });
});
