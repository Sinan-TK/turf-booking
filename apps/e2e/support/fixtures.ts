import { test as base, type APIRequestContext } from '@playwright/test';
import { apiAs, createVenue, type PwVenue } from './api';
import { ensureFreshSession } from './session';

interface TestFixtures {
  /** API clients signed in as the dev owner / Super Admin, with a session that is still valid. */
  ownerApi: APIRequestContext;
  adminApi: APIRequestContext;
}

interface WorkerFixtures {
  /** One shared venue per run, for tests that only read or make reversible changes. */
  venue: PwVenue;
  /** Creates another fresh venue, for tests that change a venue in ways that cannot be undone. */
  makeVenue: () => Promise<PwVenue>;
  /** A venue at its own coordinates far from every other venue, so a location-based customer search sees only it. */
  remoteVenue: PwVenue;
  /** Venues in two Malappuram towns about 25 km apart (Manjeri and Nilambur), the second with its own Google Maps link. */
  manjeriVenue: PwVenue;
  nilamburVenue: PwVenue;
}

export const NILAMBUR_MAPS_LINK = 'https://maps.app.goo.gl/PwNilamburLink1';

/** A random spot in the open sea west of India, where no real or test venue sits (a radius search there sees only this venue). */
const remoteSpot = () => ({ lat: 8 + Math.random() * 10, lng: 60 + Math.random() * 10 });

type Where = { lat?: number; lng?: number; district?: string; town?: string; googleMapsUrl?: string };

async function newVenue(where?: Where): Promise<PwVenue> {
  await ensureFreshSession('owner');
  await ensureFreshSession('admin');
  const [owner, admin] = [await apiAs('owner'), await apiAs('admin')];
  try {
    return await createVenue(owner, admin, where);
  } finally {
    await owner.dispose();
    await admin.dispose();
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Staff sessions expire after 15 minutes and are rotated on use, so refresh the saved login before each
  // test's browser context is created (see support/session.ts).
  storageState: async ({ storageState }, use, testInfo) => {
    const portal = testInfo.project.name;
    if (typeof storageState === 'string' && (portal === 'owner' || portal === 'admin')) await ensureFreshSession(portal);
    await use(storageState);
  },
  ownerApi: async ({}, use) => {
    await ensureFreshSession('owner');
    const api = await apiAs('owner');
    await use(api);
    await api.dispose();
  },
  adminApi: async ({}, use) => {
    await ensureFreshSession('admin');
    const api = await apiAs('admin');
    await use(api);
    await api.dispose();
  },
  venue: [async ({}, use) => use(await newVenue()), { scope: 'worker' }],
  remoteVenue: [async ({}, use) => use(await newVenue(remoteSpot())), { scope: 'worker' }],
  manjeriVenue: [async ({}, use) => use(await newVenue({ district: 'Malappuram', town: 'Manjeri', lat: 11.121, lng: 76.121 })), { scope: 'worker' }],
  nilamburVenue: [
    async ({}, use) =>
      use(await newVenue({ district: 'Malappuram', town: 'Nilambur', lat: 11.277, lng: 76.224, googleMapsUrl: NILAMBUR_MAPS_LINK })),
    { scope: 'worker' },
  ],
  makeVenue: [async ({}, use) => use(() => newVenue()), { scope: 'worker' }],
});

export { expect } from '@playwright/test';
