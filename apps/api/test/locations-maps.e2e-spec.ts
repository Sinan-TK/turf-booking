import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DateTime } from 'luxon';
import { googleMapsUrlProblem } from '@venue/shared';
import { createTestApp } from './setup/test-app';
import {
  createOwnerFixture,
  createVenueFixture,
  loginAsSuperAdmin,
  uniqueSuffix,
  type TestAgent,
} from './setup/fixtures';

/**
 * Town centres for the customer site's location picker, and a venue's optional Google Maps link (what its
 * Directions button opens): only real Google Maps addresses are accepted.
 */
describe('Town centres and the venue Google Maps link', () => {
  let app: INestApplication;
  let adminAgent: TestAgent;
  let ownerAgent: TestAgent;
  let venueId: string;
  let districtId: string;

  beforeAll(async () => {
    app = await createTestApp();
    adminAgent = await loginAsSuperAdmin(app);
    ({ ownerAgent } = await createOwnerFixture(app, adminAgent));
    ({ venueId } = await createVenueFixture(app, ownerAgent, adminAgent));
    const states = await request(app.getHttpServer()).get('/states');
    const districts = await request(app.getHttpServer()).get(`/districts?stateId=${states.body[0].id}`);
    districtId = districts.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('areas', () => {
    test('Malappuram lists its towns with their centres as plain numbers', async () => {
      const states = await request(app.getHttpServer()).get('/states');
      const kerala = states.body.find((s: { code: string }) => s.code === 'KL');
      const districts = await request(app.getHttpServer()).get(`/districts?stateId=${kerala.id}`);
      const malappuram = districts.body.find((d: { name: string }) => d.name === 'Malappuram');
      const res = await request(app.getHttpServer()).get(`/areas?districtId=${malappuram.id}`);
      expect(res.status).toBe(200);
      const names = res.body.map((a: { name: string }) => a.name);
      for (const town of ['Kottakkal', 'Manjeri', 'Perinthalmanna', 'Tirur', 'Ponnani', 'Kondotty', 'Tanur', 'Nilambur', 'Valanchery', 'Edappal']) {
        expect(names).toContain(town);
      }
      const manjeri = res.body.find((a: { name: string }) => a.name === 'Manjeri');
      expect(manjeri.lat).toBeCloseTo(11.121, 3);
      expect(manjeri.lng).toBeCloseTo(76.121, 3);
      expect(typeof manjeri.lat).toBe('number');
    });

    test('the admin creates a town with or without a centre; only both coordinates are accepted', async () => {
      const name = `E2E Town ${uniqueSuffix()}`;
      const withCentre = await adminAgent.post('/admin/areas').send({ districtId, name, lat: 10.5, lng: 76.5 });
      expect(withCentre.status).toBe(201);
      expect(withCentre.body.lat).toBe(10.5);
      const without = await adminAgent.post('/admin/areas').send({ districtId, name: `${name} b` });
      expect(without.status).toBe(201);
      expect(without.body.lat).toBeNull();
      const half = await adminAgent.post('/admin/areas').send({ districtId, name: `${name} c`, lat: 10.5 });
      expect(half.status).toBe(400);
      const outOfRange = await adminAgent.post('/admin/areas').send({ districtId, name: `${name} d`, lat: 95, lng: 10 });
      expect(outOfRange.status).toBe(400);
      expect((await ownerAgent.post('/admin/areas').send({ districtId, name: `${name} e` })).status).toBe(403);
    });
  });

  describe('googleMapsUrlProblem', () => {
    test.each([
      'https://www.google.com/maps/place/Kottakkal+Arena/@11.0,76.0,17z',
      'https://google.com/maps?q=11.0,76.0',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/AbCdEf123',
      'https://maps.google.com/?q=11,76',
      '',
      '   ',
    ])('accepts %s', (value) => {
      expect(googleMapsUrlProblem(value)).toBeUndefined();
    });

    test.each([
      'http://www.google.com/maps/place/x',
      'https://evil.example.com/maps/place/x',
      'https://www.google.com.evil.example.com/maps/x',
      'https://www.google.com/search?q=maps',
      'https://user:pass@www.google.com/maps/x',
      'javascript:alert(1)',
      'not a link',
      'https://goo.gl/other',
      `https://www.google.com/maps/${'a'.repeat(500)}`,
    ])('refuses %s', (value) => {
      expect(googleMapsUrlProblem(value)).toBeDefined();
    });
  });

  describe('venue link', () => {
    const link = 'https://maps.app.goo.gl/AbCdEf123';

    test('an owner saves, reads and clears the link', async () => {
      const set = await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: `  ${link}  ` });
      expect(set.status).toBe(200);
      expect(set.body.googleMapsUrl).toBe(link);
      expect((await ownerAgent.get(`/venues/${venueId}`)).body.googleMapsUrl).toBe(link);

      // Other edits leave it alone.
      const rename = await ownerAgent.patch(`/venues/${venueId}`).send({ description: 'new words' });
      expect(rename.body.googleMapsUrl).toBe(link);

      for (const empty of ['', '  ', null]) {
        await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: link });
        const cleared = await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: empty });
        expect(cleared.status).toBe(200);
        expect(cleared.body.googleMapsUrl).toBeNull();
      }
    });

    test('a link that is not a Google Maps address is refused with a clear message', async () => {
      const res = await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: 'https://evil.example.com/maps/x' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/Google Maps link/);
      expect((await ownerAgent.get(`/venues/${venueId}`)).body.googleMapsUrl).toBeNull(); // nothing was saved
    });

    test('a venue can be created with a link, and with a bad one it is refused', async () => {
      const districtsRes = await request(app.getHttpServer()).get('/districts');
      const base = { name: `E2E Link ${uniqueSuffix()}`, districtId: districtsRes.body[0].id, address: '1 Lane', lat: 10, lng: 76 };
      const ok = await ownerAgent.post('/venues').send({ ...base, googleMapsUrl: link });
      expect(ok.status).toBe(201);
      expect(ok.body.googleMapsUrl).toBe(link);
      const bad = await ownerAgent.post('/venues').send({ ...base, name: `${base.name} b`, googleMapsUrl: 'http://maps.google.com/x' });
      expect(bad.status).toBe(400);
      const none = await ownerAgent.post('/venues').send({ ...base, name: `${base.name} c` });
      expect(none.status).toBe(201);
      expect(none.body.googleMapsUrl).toBeNull();
    });

    test('another organization cannot change it', async () => {
      const { ownerAgent: stranger } = await createOwnerFixture(app, adminAgent);
      const res = await stranger.patch(`/venues/${venueId}`).send({ googleMapsUrl: link });
      expect(res.status).toBe(403);
    });

    test('search results carry the link so the Directions button can use it', async () => {
      await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: link });
      const venue = (await ownerAgent.get(`/venues/${venueId}`)).body as { facilityCode: string };
      const day = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toFormat('yyyy-MM-dd');
      const res = await request(app.getHttpServer()).get(
        `/search?facilityCode=${venue.facilityCode}&date=${day}&timeWindow=EVENING&durationMinutes=60`,
      );
      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].venue.googleMapsUrl).toBe(link);

      await ownerAgent.patch(`/venues/${venueId}`).send({ googleMapsUrl: null });
      const without = await request(app.getHttpServer()).get(
        `/search?facilityCode=${venue.facilityCode}&date=${day}&timeWindow=EVENING&durationMinutes=60`,
      );
      expect(without.body[0].venue.googleMapsUrl).toBeNull();
    });
  });
});
