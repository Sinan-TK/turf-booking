import { request } from '@playwright/test';
import { statSync } from 'node:fs';
import { ACCOUNTS, URLS } from './env';

/**
 * A staff login lasts 15 minutes (JWT_ACCESS_TTL) and its refresh token is rotated on use, so one saved login
 * cannot serve a long run: once it expires, each browser context would try to refresh with the same old
 * token and the later ones would be signed out. Before a test starts we therefore replace the saved login
 * (through the API, the same call the login page makes) whenever it is older than a few minutes.
 */
const MAX_AGE_MS = 6 * 60_000;

export async function ensureFreshSession(portal: 'owner' | 'admin'): Promise<void> {
  const file = `.auth/${portal}.json`;
  let age = Number.POSITIVE_INFINITY;
  try {
    age = Date.now() - statSync(file).mtimeMs;
  } catch {
    // no saved login yet: the setup project creates it
    return;
  }
  if (age < MAX_AGE_MS) return;

  const api = await request.newContext({ baseURL: URLS.api });
  try {
    const res = await api.post(`/auth/${portal}/login`, { data: ACCOUNTS[portal], timeout: 30_000 });
    if (res.ok()) await api.storageState({ path: file });
  } finally {
    await api.dispose();
  }
}
