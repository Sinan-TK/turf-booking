import { expect, request, test as setup } from '@playwright/test';
import { existsSync } from 'node:fs';
import { ACCOUNTS, URLS } from '../support/env';

/** The dev API restarts whenever its source is rebuilt; give it up to a minute to come back before testing. */
async function waitForApi(): Promise<void> {
  const api = await request.newContext({ baseURL: URLS.api });
  try {
    await expect.poll(async () => (await api.get('/health').catch(() => null))?.status(), { timeout: 60_000, intervals: [1000] }).toBe(200);
  } finally {
    await api.dispose();
  }
}

/**
 * Signs in through the real login page and saves the session for the owner and admin projects (the API
 * sets httpOnly cookies, so the saved state is all they need). A saved session that still works is reused,
 * because the API rate-limits logins and every `playwright test` run would otherwise spend two of them.
 * The login page itself (wrong password, show/hide password) is tested in each portal's login.spec.ts.
 */
const PROBE = { owner: '/owner/dashboard/summary', admin: '/admin/customers?limit=1' } as const;

async function savedSessionWorks(portal: 'owner' | 'admin'): Promise<boolean> {
  const file = `.auth/${portal}.json`;
  if (!existsSync(file)) return false;
  const api = await request.newContext({ baseURL: URLS.api, storageState: file });
  try {
    return (await api.get(PROBE[portal])).ok();
  } finally {
    await api.dispose();
  }
}

for (const portal of ['owner', 'admin'] as const) {
  setup(`sign in to the ${portal} portal`, async ({ page }) => {
    await waitForApi();
    if (await savedSessionWorks(portal)) return;

    const { email, password } = ACCOUNTS[portal];
    await page.goto(`${URLS[portal]}/login`);
    await page.getByPlaceholder('you@company.com').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.context().storageState({ path: `.auth/${portal}.json` });
  });
}
