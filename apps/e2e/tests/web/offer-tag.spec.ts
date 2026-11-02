import { expect, test, type Page } from '@playwright/test';
import { URLS } from '../../support/env';
import { exploreLaterDay } from '../../support/customer-ui';

test.use({ baseURL: URLS.web });

/** Every start time gets a normal price a quarter above what is charged (so a 20% offer), or none at all. */
async function withOffers(page: Page, on: boolean) {
  await page.route(`${URLS.api}/search**`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const rows = (await res.json()) as Array<{ startPrices?: string[]; startNormalPrices?: Array<string | null>; price?: { amount: string; normalAmount?: string | null } | null }>;
    const changed = rows.map((r) => ({
      ...r,
      startNormalPrices: (r.startPrices ?? []).map((p) => (on ? String(Number(p) * 1.25) : null)),
      price: r.price ? { ...r.price, normalAmount: on ? String(Number(r.price.amount) * 1.25) : null } : r.price,
    }));
    await route.fulfill({ response: res, json: changed });
  });
}

test.describe('customer site: offers and the venue picture buttons', () => {
  test('an offer shows as a tag on the card, on the venue picture and above the slots, with the normal price struck through', async ({ page }) => {
    await withOffers(page, true);
    await exploreLaterDay(page);
    const card = page.getByRole('article').first();
    await expect(card).toBeVisible();
    await expect(card.getByText('20% off')).toBeVisible();

    await card.getByRole('link', { name: 'Book Now' }).click();
    await expect(page).toHaveURL(/\/book\//);
    const venue = page.getByRole('article').first();
    // Top-left of the big picture.
    const picture = venue.locator('div.relative').first();
    const tag = picture.getByText('20% off');
    await expect(tag).toBeVisible();
    const box = (await picture.boundingBox())!;
    const tagBox = (await tag.boundingBox())!;
    expect(tagBox.x - box.x).toBeLessThan(box.width / 3);
    expect(tagBox.y - box.y).toBeLessThan(box.height / 3);
    // Above the slots, and on the slots themselves.
    await expect(venue.getByText(/Offer on (every slot today|\d+ of \d+ slots)/)).toBeVisible();
    await expect(venue.locator('s').first()).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('no offer, no tag', async ({ page }) => {
    await withOffers(page, false);
    await exploreLaterDay(page);
    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(page.getByText(/% off/i)).toHaveCount(0);
    await page.getByRole('article').first().getByRole('link', { name: 'Book Now' }).click();
    await expect(page).toHaveURL(/\/book\//);
    await expect(page.getByRole('article').first().getByRole('tab').first()).toBeVisible();
    await expect(page.getByText(/% off|Offer on/i)).toHaveCount(0);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Directions sits at the bottom right of the venue picture and Save at the top right', async ({ page }) => {
    await exploreLaterDay(page);
    await page.getByRole('article').first().getByRole('link', { name: 'Book Now' }).click();
    await expect(page).toHaveURL(/\/book\//);
    const venue = page.getByRole('article').first();
    const picture = venue.locator('div.relative').first();
    await expect(venue.getByRole('link', { name: 'Directions' })).toBeVisible();
    const box = (await picture.boundingBox())!;
    const dir = (await picture.getByRole('link', { name: 'Directions' }).boundingBox())!;
    const save = (await picture.getByRole('button', { name: /^Save / }).boundingBox())!;
    expect(dir.x + dir.width / 2).toBeGreaterThan(box.x + box.width / 2);
    expect(dir.y + dir.height / 2).toBeGreaterThan(box.y + box.height / 2);
    expect(save.x + save.width / 2).toBeGreaterThan(box.x + box.width / 2);
    expect(save.y + save.height / 2).toBeLessThan(box.y + box.height / 2);

    // Signed out, tapping Save asks the visitor to log in.
    await picture.getByRole('button', { name: /^Save / }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
