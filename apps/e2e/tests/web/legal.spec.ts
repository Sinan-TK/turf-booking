import { expect, test } from '@playwright/test';
import { scanForViolations } from '../../support/csp';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

const PAGES = [
  { path: '/terms', title: 'Terms of Use', link: 'Terms of Use' },
  { path: '/privacy', title: 'Privacy Policy', link: 'Privacy Policy' },
  { path: '/refunds', title: 'Cancellation & Refund Policy', link: 'Cancellation & Refunds' },
  { path: '/cookies', title: 'Cookie Policy', link: 'Cookie Policy' },
];

/** The legal pages: each opens without signing in, has a dated title and a working contents list, and is linked from the footer. */
test.describe('customer site: legal pages', () => {
  for (const p of PAGES) {
    test(`${p.path} opens signed out with its title, date and contents`, async ({ page }) => {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { name: p.title, level: 1 })).toBeVisible();
      await expect(page.getByText(/Last updated \d+ \w+ \d{4}/)).toBeVisible();
      // The contents list jumps to its section.
      const toc = page.getByRole('navigation', { name: 'On this page' });
      const entries = toc.getByRole('link');
      expect(await entries.count()).toBeGreaterThan(3);
      const last = entries.last();
      const id = (await last.getAttribute('href'))!.slice(1);
      await last.click();
      await expect(page.locator(`section#${id}`)).toBeInViewport();
      // The other policies are one click away.
      const legal = page.getByRole('navigation', { name: 'Legal' });
      for (const q of PAGES) await expect(legal.getByRole('link', { name: q.link })).toBeVisible();
    });
  }

  test('the footer has no venue-owner section and the Venue Partner Terms are not on the customer site', async ({ page }) => {
    for (const path of ['/', '/terms']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'For venue owners' })).toHaveCount(0);
      await expect(page.locator('footer').getByRole('link', { name: /Venue Partner Terms|Owner sign in/ })).toHaveCount(0);
    }
    await expect(page.getByRole('heading', { name: 'Own a venue?' })).toHaveCount(0); // (only the landing page has that section)
    expect((await page.request.get('/partner-terms')).status()).toBe(404);
  });

  test('the landing page keeps its Own a venue section above the footer', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Own a venue?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'List your venue' })).toHaveAttribute('href', /\/register$/);
  });

  test('the landing page footer links to every legal page', async ({ page }) => {
    await page.goto('/');
    const legal = page.getByRole('navigation', { name: 'Legal' });
    for (const p of PAGES) await expect(legal.getByRole('link', { name: p.link })).toHaveAttribute('href', p.path);
    await legal.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
  });

  test('signing up or logging in says that continuing means agreeing to the terms and privacy policy', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log in' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/By continuing you agree to our/)).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    await expect(dialog.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  test('the legal pages run with nothing blocked by the content security policy', async ({ page }) => {
    const seen = await scanForViolations(page, PAGES.map((p) => p.path));
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
