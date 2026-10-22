/** Where the apps are served, and the dev accounts (created by `pnpm --filter @venue/database seed:identity`). */
export const URLS = {
  api: process.env.E2E_API_URL ?? 'http://localhost:4000',
  web: process.env.E2E_WEB_URL ?? 'http://localhost:3000',
  admin: process.env.E2E_ADMIN_URL ?? 'http://localhost:3001',
  owner: process.env.E2E_OWNER_URL ?? 'http://localhost:3002',
};

export const ACCOUNTS = {
  admin: { email: process.env.E2E_ADMIN_EMAIL ?? 'admin@turf.local', password: process.env.E2E_DEV_PASSWORD ?? 'DevPassword123!' },
  owner: { email: process.env.E2E_OWNER_EMAIL ?? 'owner@turf.local', password: process.env.E2E_DEV_PASSWORD ?? 'DevPassword123!' },
};

/** A short unique suffix so every run creates uniquely named data. */
export const unique = () => Math.random().toString(36).slice(2, 8);
