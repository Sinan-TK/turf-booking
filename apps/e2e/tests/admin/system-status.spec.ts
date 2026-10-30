import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';

/** API health on the Super Admin pages: a status card on the dashboard and a pill in the sidebar, both kept fresh. */
test.describe('admin: API status', () => {
  test('the dashboard card shows a healthy API, when it was checked and the database check', async ({ page }) => {
    await page.goto('/dashboard');
    const card = page.getByTestId('system-status');
    await expect(card).toHaveAttribute('data-state', 'healthy');
    await expect(card.getByText('Healthy', { exact: true })).toBeVisible();
    await expect(card.getByText('Last checked')).toBeVisible();
    await expect(card.getByText('Database')).toBeVisible();
    await expect(card.getByText('Answering queries.')).toBeVisible();
    await expect(card.getByText(/Refreshes every 30 seconds/)).toBeVisible();
    // Nothing that looks like a connection string, host or secret is on the card.
    expect(await card.innerText()).not.toMatch(/postgres|password|secret|neon\.tech|DATABASE_URL/i);
  });

  test('the sidebar pill is on every page and "Check now" refreshes the time', async ({ page }) => {
    await page.goto('/venues');
    await expect(page.getByTestId('api-status-pill')).toHaveAttribute('data-state', 'healthy');
    await page.goto('/dashboard');
    let checks = 0;
    await page.route(`${URLS.api}/admin/system/health`, (route) => {
      checks += 1;
      return route.continue();
    });
    await page.getByRole('button', { name: 'Check now' }).click();
    await expect.poll(() => checks).toBeGreaterThan(0);
  });

  test('when the API reports a failing database the card and pill say degraded, with a plain reason', async ({ page }) => {
    await page.route(`${URLS.api}/admin/system/health`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({
          status: 'degraded',
          checkedAt: new Date().toISOString(),
          uptimeSeconds: 125,
          checks: [{ name: 'Database', status: 'down', latencyMs: 40, message: 'The database is not answering. Bookings and sign-in will fail until it is back.' }],
        }),
      }),
    );
    await page.goto('/dashboard');
    await expect(page.getByTestId('system-status')).toHaveAttribute('data-state', 'degraded');
    await expect(page.getByTestId('system-status').getByRole('alert')).toContainText('The database is not answering');
    await expect(page.getByTestId('api-status-pill')).toHaveAttribute('data-state', 'degraded');
  });

  test('when the API cannot be reached the page still works and says unavailable without a raw error', async ({ page }) => {
    await page.route(`${URLS.api}/admin/system/health`, (route) => route.abort('connectionrefused'));
    await page.route(`${URLS.api}/health`, (route) => route.abort('connectionrefused'));
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    const card = page.getByTestId('system-status');
    await expect(card).toHaveAttribute('data-state', 'unavailable');
    await expect(card.getByRole('alert')).toContainText('The API cannot be reached');
    expect(await card.innerText()).not.toMatch(/Failed to fetch|ECONN|TypeError/i);
    await expect(page.getByTestId('api-status-pill')).toHaveAttribute('data-state', 'unavailable');
  });

  test('a database outage seen through the public probe is told apart from an unreachable API', async ({ page }) => {
    await page.route(`${URLS.api}/admin/system/health`, (route) =>
      route.fulfill({ status: 500, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin, 'access-control-allow-credentials': 'true' }, body: '{"message":"Internal server error"}' }),
    );
    await page.route(`${URLS.api}/health`, (route) =>
      route.fulfill({ status: 503, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin }, body: '{"status":"down"}' }),
    );
    await page.goto('/dashboard');
    await expect(page.getByTestId('system-status').getByRole('alert')).toContainText('running but its database is not answering');
  });
});
