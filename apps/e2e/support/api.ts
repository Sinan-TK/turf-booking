import { expect, request, type APIRequestContext } from '@playwright/test';
import { ACCOUNTS, URLS, unique } from './env';

/**
 * An API client signed in as the dev owner or Super Admin. It reuses the session the setup project saved
 * from the real login page (the API's httpOnly cookies are host-scoped, so they work for port 4000 too),
 * which also avoids hammering the rate-limited login endpoint every time a worker restarts.
 */
export async function apiAs(portal: 'owner' | 'admin'): Promise<APIRequestContext> {
  const probe = portal === 'owner' ? '/owner/dashboard/summary' : '/admin/customers?limit=1';
  const saved = await request.newContext({ baseURL: URLS.api, storageState: `.auth/${portal}.json` });
  if ((await saved.get(probe)).ok()) return saved;
  // The saved session has expired: sign in with the account's credentials instead.
  await saved.dispose();
  const ctx = await request.newContext({ baseURL: URLS.api });
  const res = await ctx.post(`/auth/${portal}/login`, { data: ACCOUNTS[portal] });
  expect(res.ok(), `${portal} API login failed (${res.status()}). Is the dev stack seeded?`).toBeTruthy();
  return ctx;
}

export interface PwVenue {
  lat: number;
  lng: number;
  id: string;
  name: string;
  facilityCode: string;
  turfId: string;
  turfName: string;
  courtId: string;
  courtName: string;
}

type ApiResponse = Awaited<ReturnType<APIRequestContext['get']>>;

/** Runs a request and, if the server answers 5xx (a transient hiccup), tries once more. */
async function sturdy(send: () => Promise<ApiResponse>): Promise<ApiResponse> {
  const first = await send();
  if (first.status() < 500) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return send();
}

async function json<T>(res: ApiResponse): Promise<T> {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/**
 * A fresh ACTIVE venue for a test to play with: a football turf (5-a-side) and a badminton court, both
 * priced (turf Mon-Fri 800 / Sat-Sun 1000 from 06:00 to 22:00, court 300 all day). Named "PW Venue …".
 */
export async function createVenue(
  owner: APIRequestContext,
  admin: APIRequestContext,
  where: { lat?: number; lng?: number } = {},
): Promise<PwVenue> {
  const name = `PW Venue ${unique()}`;
  const states = await json<Array<{ id: string }>>(await owner.get('/states'));
  const districts = await json<Array<{ id: string }>>(await owner.get(`/districts?stateId=${states[0]!.id}`));
  const venue = await json<{ id: string; facilityCode: string }>(
    await owner.post('/venues', {
      data: { name, description: 'Created by the Playwright suite', districtId: districts[0]!.id, address: '1 Test Lane', lat: where.lat ?? 11.05, lng: where.lng ?? 76.07 },
    }),
  );
  await json(await sturdy(() => admin.patch(`/venues/${venue.id}`, { data: { status: 'ACTIVE' } })));

  const cats = await json<Array<{ id: string; slug: string }>>(await owner.get('/categories'));
  const cat = (slug: string) => cats.find((c) => c.slug === slug)!.id;
  const turfName = 'Turf A';
  const courtName = 'Court 1';
  const turf = await json<{ id: string }>(
    await sturdy(() => owner.post('/resources', { data: { venueId: venue.id, categoryId: cat('FOOTBALL_TURF'), name: turfName, groundType: '5S', sortOrder: 0 } })),
  );
  const court = await json<{ id: string }>(
    await sturdy(() => owner.post('/resources', { data: { venueId: venue.id, categoryId: cat('BADMINTON'), name: courtName, sortOrder: 1 } })),
  );
  const price = (resourceId: string, days: number[], amount: number, hours?: [string, string]) =>
    sturdy(() => owner.post('/resources/pricing-rules', {
      data: {
        resourceId,
        durationMinutes: 60,
        days,
        price: amount,
        ...(hours ? { startWindow: hours[0], endWindow: hours[1] } : {}),
      },
    }));
  for (const res of await Promise.all([
    price(turf.id, [1, 2, 3, 4, 5], 800, ['06:00', '22:00']),
    price(turf.id, [6, 7], 1000, ['06:00', '22:00']),
    price(court.id, [1, 2, 3, 4, 5, 6, 7], 300),
  ])) {
    expect(res.ok(), `price setup failed: ${await res.text()}`).toBeTruthy();
  }
  return { lat: where.lat ?? 11.05, lng: where.lng ?? 76.07, id: venue.id, name, facilityCode: venue.facilityCode, turfId: turf.id, turfName, courtId: court.id, courtName };
}
