import { createHash, randomBytes } from 'node:crypto';
import { expect, request, type APIRequestContext } from '@playwright/test';
import { URLS, unique } from './env';
import { database } from './customer';

export const STAFF_PASSWORD = 'PwStaff123!x';

export interface PwStaff {
  id: string;
  name: string;
  email: string;
  password: string;
}

/**
 * Invites staff through the real owner API, then sets their password the way the emailed link would: the
 * invite email cannot be read by a test, so a known invite token is planted in the same table the API
 * writes (it stores only a hash) and redeemed through the real reset-password endpoint.
 */
export async function createStaff(owner: APIRequestContext, venueIds: string[], label = 'Staff'): Promise<PwStaff> {
  const name = `PW ${label} ${unique()}`;
  const email = `pw-staff-${unique()}@example.com`;
  const res = await owner.post('/owner/staff', { data: { name, email, venueIds } });
  expect(res.ok(), `invite failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const { id } = (await res.json()) as { id: string };

  const raw = randomBytes(32).toString('base64url');
  const prisma = await database();
  await prisma.staffAuthToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.staffAuthToken.create({
    data: {
      portal: 'OWNER',
      userId: id,
      purpose: 'INVITE',
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const api = await request.newContext({ baseURL: URLS.api });
  const set = await api.post('/auth/owner/reset-password', { data: { token: raw, password: STAFF_PASSWORD } });
  expect(set.ok(), `set password failed: ${set.status()} ${await set.text()}`).toBeTruthy();
  await api.dispose();
  return { id, name, email, password: STAFF_PASSWORD };
}
