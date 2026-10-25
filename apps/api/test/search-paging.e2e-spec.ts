import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup/test-app';
import { createOwnerFixture, createVenueFixture, loginAsSuperAdmin, prisma, uniqueSuffix } from './setup/fixtures';

/** Search answers a page at a time: at most `limit` cards, with where the next page starts in X-Next-Cursor. */
describe('search results come in pages', () => {
  let app: INestApplication;
  const tag = uniqueSuffix();
  const TEXT = `Paging ${tag}`;
  const date = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  const search = (extra: Record<string, string | number> = {}) =>
    request(app.getHttpServer())
      .get('/search')
      .query({ date, timeWindow: 'ALL', durationMinutes: 60, lat: 10, lng: 76, radiusKm: 5, q: TEXT, ...extra });
  const keys = (body: Array<{ venue: { id: string }; resource: { id: string } }>) => body.map((r) => `${r.venue.id}/${r.resource.id}`);

  beforeAll(async () => {
    app = await createTestApp();
    const admin = await loginAsSuperAdmin(app);
    const owner = (await createOwnerFixture(app, admin)).ownerAgent;
    // Four venues of three units each: twelve cards, named so only they match the text filter.
    const venueIds: string[] = [];
    for (let i = 1; i <= 4; i++) venueIds.push((await createVenueFixture(app, owner, admin)).venueId);
    for (const [i, id] of venueIds.entries()) await prisma.venue.update({ where: { id }, data: { name: `${TEXT} V${i + 1}` } });
  });
  afterAll(async () => app.close());

  it('without a limit everything comes at once, with no cursor', async () => {
    const res = await search().expect(200);
    expect(res.body).toHaveLength(12);
    expect(res.headers['x-next-cursor']).toBeUndefined();
  });

  it('pages of five add up to exactly the full list, in the same order, with no overlap', async () => {
    const full = keys((await search().expect(200)).body);
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const res = await search({ limit: 5, ...(cursor ? { cursor } : {}) }).expect(200);
      sizes.push(res.body.length);
      expect(res.body.length).toBeLessThanOrEqual(5);
      seen.push(...keys(res.body));
      cursor = res.headers['x-next-cursor'];
      if (!cursor) break;
    }
    expect(sizes).toEqual([5, 5, 2]);
    expect(seen).toEqual(full);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('a page can end in the middle of a venue and the next one carries on from the next unit', async () => {
    const full = keys((await search().expect(200)).body);
    const first = await search({ limit: 4 }).expect(200); // venue 1 has three units, so this stops after one unit of venue 2
    expect(keys(first.body)).toEqual(full.slice(0, 4));
    expect(first.headers['x-next-cursor']).toMatch(/^1\.1$/);
    const second = await search({ limit: 4, cursor: first.headers['x-next-cursor'] }).expect(200);
    expect(keys(second.body)).toEqual(full.slice(4, 8));
  });

  it('is also fast: the whole page is computed with the reads overlapping', async () => {
    const t0 = Date.now();
    await search({ limit: 10 }).expect(200);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('the text filter narrows to the matching venue, and the paging follows the filtered list', async () => {
    const res = await search({ q: `${TEXT} V2`, limit: 2 }).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((r: { venue: { name: string } }) => r.venue.name === `${TEXT} V2`)).toBe(true);
    expect(res.headers['x-next-cursor']).toBe('0.2'); // the third unit of the one matching venue
    const rest = await search({ q: `${TEXT} V2`, limit: 2, cursor: '0.2' }).expect(200);
    expect(rest.body).toHaveLength(1);
    expect(rest.headers['x-next-cursor']).toBeUndefined();
    expect((await search({ q: 'no-such-venue-zzz' }).expect(200)).body).toEqual([]);
  });

  it('a cursor past the end gives an empty page, and a bad cursor or limit is refused', async () => {
    const past = await search({ limit: 5, cursor: '99.0' }).expect(200);
    expect(past.body).toEqual([]);
    expect(past.headers['x-next-cursor']).toBeUndefined();
    await search({ limit: 5, cursor: 'abc' }).expect(400);
    await search({ limit: 0 }).expect(400);
    await search({ limit: 51 }).expect(400);
  });
});
