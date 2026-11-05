import { expect, test } from '@playwright/test';

/** The portal can be installed as an app: it has a manifest with icons, a service worker that starts, and an offline page. */
test.describe('admin portal: installable app', () => {
  test('serves a manifest with its name, colours and icons', async ({ page, request }) => {
    await page.goto('/login');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
    expect(manifest.name).toMatch(/Bookyo/);
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#050505');
    expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`)).toEqual(expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']));
    for (const icon of manifest.icons) expect((await request.get(new URL(icon.src, page.url()).toString())).ok()).toBe(true);
  });

  test('starts its service worker without a security-policy error, and shows the offline page when the network is gone', async ({ page, context }) => {
    const problems: string[] = [];
    page.on('console', (m) => /Content Security Policy|service worker/i.test(m.text()) && problems.push(m.text()));
    await page.goto('/login');
    await page.evaluate(() => navigator.serviceWorker.ready);
    expect(problems).toEqual([]);

    // A page opened with no network falls back to the offline page the worker kept.
    await page.reload(); // now controlled by the worker
    await context.setOffline(true);
    await page.goto('/login').catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible();
    await context.setOffline(false);
  });
});
