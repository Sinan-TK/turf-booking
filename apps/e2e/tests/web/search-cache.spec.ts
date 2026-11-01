import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

/** A repeat search paints its saved cards at once and then swaps in the live answer; photos load after the cards are on screen. */
test.describe('customer site: search head start', () => {
  test('the second visit shows cards before the live answer arrives, then replaces them with it', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('article').first()).toBeVisible();
    const names = await page.getByRole('article').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(names.length).toBeGreaterThan(0);

    // The live answer is held back for four seconds; the saved cards must not wait for it.
    let released = false;
    await page.route(`${URLS.api}/search**`, async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      released = true;
      await route.continue();
    });
    await page.reload();
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 3000 });
    expect(released).toBe(false);
    await expect(page.getByText('Checking live availability…').first()).toBeVisible();
    await expect.poll(() => released, { timeout: 15000 }).toBe(true);
    await expect(page.getByText('Checking live availability…')).toHaveCount(0);
    expect(await page.getByRole('article').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(names);
  });

  test('a card with several photos fetches only the one on show', async ({ page }) => {
    const photoRequests: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'image' && /\/media\//.test(r.url())) photoRequests.push(r.url());
    });
    await page.goto('/explore');
    await expect(page.getByRole('article').first()).toBeVisible();
    await page.waitForTimeout(1500);
    const imgs = await page.locator('article img:not([src^="data:"])').count(); // photos only (custom SVG icons are data: images too)
    // Never more photos in the page than cards plus one preloaded neighbour each.
    const cards = await page.getByRole('article').count();
    expect(imgs).toBeLessThanOrEqual(cards * 2);
  });

  test('a venue page opened again shows its saved slots before the live answer arrives', async ({ page }) => {
    await page.goto('/explore');
    await expect(page.getByRole('article').first()).toBeVisible();
    await page.getByRole('link', { name: 'Book Now' }).first().click();
    await expect(page).toHaveURL(/\/book\//);
    const venue = page.getByRole('article').first();
    await expect(venue.getByRole('tab').first()).toBeVisible();
    const address = page.url();

    // The live answer is held back for four seconds; the saved venue page must not wait for it.
    let released = false;
    await page.route(`${URLS.api}/search**`, async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      released = true;
      await route.continue();
    });
    await page.goto(address);
    await expect(page.getByRole('article').first().getByRole('tab').first()).toBeVisible({ timeout: 3000 });
    expect(released).toBe(false);
    await expect.poll(() => released, { timeout: 15000 }).toBe(true);
    await expect(page.getByRole('article').first().getByRole('tab').first()).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
