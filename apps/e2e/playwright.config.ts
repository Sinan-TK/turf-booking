import { defineConfig } from '@playwright/test';
import { URLS } from './support/env';

/**
 * Browser tests for the three apps (customer site, Super Admin, Owner/staff).
 *
 * They run against whatever is already serving the URLs in support/env.ts (the normal
 * `pnpm dev` stack: API 4000, web 3000, admin 3001, owner 3002) and use the real dev
 * database, creating their own "PW …" data rather than touching existing venues.
 *
 * Uses the machine's installed Chrome (no browser download). Set E2E_CHANNEL=msedge, or
 * E2E_CHANNEL= (empty) after \`pnpm exec playwright install chromium\`, to change that.
 */
const channel = process.env.E2E_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './tests',
  // Removes what the tests created once the whole run is over (skip it with E2E_KEEP_DATA=1).
  globalTeardown: './support/global-teardown.ts',
  outputDir: './test-results',
  timeout: 60_000,
  // Generous waits: the apps run in dev mode, where a page can take several seconds to compile the first time it is opened.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...(channel ? { channel } : {}),
    headless: !process.env.E2E_HEADED,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'owner',
      testMatch: /owner\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { baseURL: URLS.owner, storageState: '.auth/owner.json' },
    },
    {
      name: 'admin',
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { baseURL: URLS.admin, storageState: '.auth/admin.json' },
    },
    {
      name: 'web',
      testMatch: /web\/.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { baseURL: URLS.web },
    },
  ],
});
