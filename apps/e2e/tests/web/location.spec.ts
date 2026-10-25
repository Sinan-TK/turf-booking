import type { Page } from '@playwright/test';
import { settled, shareLocation } from '../../support/customer-ui';
import { expect, NILAMBUR_MAPS_LINK, test } from '../../support/fixtures';

/**
 * Where the customer is searching: Malappuram by default, a picker that is a full page on phones and a modal on
 * big screens, a current-location button that explains what went wrong, and Directions links (no "km away").
 */
const header = (page: Page, now: string | RegExp) => page.getByRole('button', { name: new RegExp(`^Change location, now ${typeof now === 'string' ? now : now.source}`) });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Choose your location' });
/** The results come ten at a time, so a test venue among hundreds is found by typing its name (the server filters the whole list). */
const find = async (page: Page, name: string) => {
  await page.getByPlaceholder('Search venues, names or areas...').fill(name);
  await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 30_000 });
};
const venueCard = (page: Page, name: string) => page.locator('article').filter({ hasText: name }).filter({ visible: true }).first();

test.describe('customer site: location', () => {
  test('opens on Malappuram and lists its venues without asking for a location', async ({ page, manjeriVenue }) => {
    await page.goto('/');
    await expect(header(page, 'Malappuram')).toBeVisible();
    await expect(page.getByText('Tap to choose')).toHaveCount(0);
    await settled(page);
    await find(page, manjeriVenue.name);
  });

  test('the picker lists Malappuram\'s towns, filters them as you type, and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await header(page, 'Malappuram').click();
    const dialog = picker(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Use my current location' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'All of Malappuram' })).toBeVisible();
    for (const town of ['Kottakkal', 'Manjeri', 'Perinthalmanna', 'Tirur', 'Ponnani', 'Kondotty', 'Tanur', 'Nilambur', 'Valanchery', 'Edappal']) {
      await expect(dialog.getByRole('button', { name: town, exact: true })).toBeVisible();
    }

    await dialog.getByLabel('Search towns').fill('man');
    await expect(dialog.getByRole('button', { name: 'Manjeri', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Tirur', exact: true })).toHaveCount(0);
    await dialog.getByLabel('Search towns').fill('zzz');
    await expect(dialog.getByText(/No town matches/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(header(page, 'Malappuram')).toBeFocused(); // focus goes back to what opened it
  });

  test('on a big screen the picker is a centred modal; on a phone it fills the screen', async ({ page }) => {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto('/');
    await header(page, 'Malappuram').click();
    const modal = await picker(page).boundingBox();
    expect(modal!.width).toBeLessThan(520);
    expect(modal!.x).toBeGreaterThan(300); // centred, not stuck to a side
    expect(modal!.y).toBeGreaterThan(20);
    await expect(picker(page).getByRole('button', { name: 'Back' })).toBeHidden();
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 390, height: 800 });
    await header(page, 'Malappuram').click();
    const full = await picker(page).boundingBox();
    expect(full).toMatchObject({ x: 0, y: 0, width: 390, height: 800 });
    // The phone layout has its own back arrow, which closes it.
    await picker(page).getByRole('button', { name: 'Back' }).click();
    await expect(picker(page)).toHaveCount(0);
  });

  test('choosing a town searches around it, and the choice survives a reload', async ({ page, manjeriVenue, nilamburVenue }) => {
    await page.goto('/');
    await settled(page);
    await find(page, nilamburVenue.name);

    await header(page, 'Malappuram').click();
    await picker(page).getByRole('button', { name: 'Manjeri', exact: true }).click();
    await expect(picker(page)).toHaveCount(0);
    await expect(header(page, 'Manjeri')).toBeVisible();
    await settled(page);
    await find(page, manjeriVenue.name);
    await page.getByPlaceholder('Search venues, names or areas...').fill(nilamburVenue.name);
    await expect(page.getByRole('heading', { name: nilamburVenue.name })).toHaveCount(0); // about 20 km away

    await page.reload();
    await expect(header(page, 'Manjeri')).toBeVisible();
    await settled(page);
    await find(page, manjeriVenue.name);

    // The whole district again.
    await header(page, 'Manjeri').click();
    await expect(picker(page).getByRole('button', { name: 'Manjeri', exact: true })).toContainText('Manjeri');
    await picker(page).getByRole('button', { name: 'All of Malappuram' }).click();
    await expect(header(page, 'Malappuram')).toBeVisible();
    await settled(page);
    await find(page, nilamburVenue.name);
  });

  test('a location chosen before the default has loaded is not replaced by the default', async ({ page, context, remoteVenue }) => {
    // Hold the default's lookup back, as on a slow connection.
    await page.route('**/districts?stateId=*', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await page.goto('/');
    await page.getByRole('button', { name: /Change location/ }).click();
    await picker(page).getByRole('button', { name: 'Use my current location' }).click();
    await expect(header(page, /Your location|Near/)).toBeVisible();
    await page.waitForTimeout(4500); // long enough for the late default to arrive
    await expect(header(page, /Your location|Near/)).toBeVisible();
    await settled(page);
    await expect(page.getByRole('heading', { name: remoteVenue.name }).first()).toBeVisible({ timeout: 30_000 });
  });

  test('another district can be chosen from the picker', async ({ page }) => {
    await page.goto('/');
    await header(page, 'Malappuram').click();
    const dialog = picker(page);
    await dialog.getByRole('button', { name: /Other district/ }).click();
    await dialog.getByLabel('District').selectOption({ label: 'Kozhikode' });
    await expect(dialog.getByRole('button', { name: 'All of Kozhikode' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Manjeri', exact: true })).toHaveCount(0); // Malappuram's towns are gone
    await dialog.getByRole('button', { name: 'All of Kozhikode' }).click();
    await expect(header(page, 'Kozhikode')).toBeVisible();
  });

  test('current location: names the closest town and searches near it', async ({ page, context, manjeriVenue }) => {
    await shareLocation(context, 11.12, 76.12);
    await page.goto('/');
    await header(page, 'Malappuram').click();
    await picker(page).getByRole('button', { name: 'Use my current location' }).click();
    await expect(picker(page)).toHaveCount(0);
    await expect(header(page, 'Near Manjeri')).toBeVisible();
    await expect(page.getByText('Using your current location')).toBeVisible();
    await settled(page);
    await find(page, manjeriVenue.name);
  });

  test('current location: a blocked permission says so and how to fix it; the picker stays open', async ({ page }) => {
    await page.goto('/');
    await header(page, 'Malappuram').click();
    await picker(page).getByRole('button', { name: 'Use my current location' }).click();
    const alert = picker(page).getByRole('alert');
    await expect(alert).toContainText('Location is blocked for this site');
    await expect(alert).toContainText('pick a town');
    await expect(picker(page)).toBeVisible();
    // A town still works from there.
    await picker(page).getByRole('button', { name: 'Tirur', exact: true }).click();
    await expect(header(page, 'Tirur')).toBeVisible();
  });

  test('current location far from any venue offers to browse the district instead of an empty page', async ({ page, context }) => {
    await shareLocation(context, 12.97, 77.59); // Bengaluru
    await page.goto('/');
    await header(page, 'Malappuram').click();
    await picker(page).getByRole('button', { name: 'Use my current location' }).click();
    await expect(header(page, 'Your location')).toBeVisible();
    await settled(page);
    await expect(page.getByText('No venues are open near you for that search.')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Browse all of Malappuram' }).click();
    await expect(header(page, 'Malappuram')).toBeVisible();
  });
});

test.describe('customer site: venue cards and Directions', () => {
  test('no "km away" on a card; Directions uses the venue\'s Google Maps link, else a route to its pin', async ({ page, manjeriVenue, nilamburVenue }) => {
    await page.goto('/');
    await settled(page);
    await find(page, nilamburVenue.name);
    await expect(page.getByText(/km away/)).toHaveCount(0);

    const withLink = venueCard(page, nilamburVenue.name).getByRole('link', { name: 'Directions' });
    await expect(withLink).toHaveAttribute('href', NILAMBUR_MAPS_LINK);
    await expect(withLink).toHaveAttribute('target', '_blank');

    await find(page, manjeriVenue.name);
    const pinOnly = venueCard(page, manjeriVenue.name).getByRole('link', { name: 'Directions' });
    await expect(pinOnly).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${manjeriVenue.lat},${manjeriVenue.lng}`);
  });

  test('the same holds in near-me mode, where the distance used to be shown', async ({ page, context, manjeriVenue }) => {
    await shareLocation(context, 11.12, 76.12);
    await page.goto('/');
    await header(page, 'Malappuram').click();
    await picker(page).getByRole('button', { name: 'Use my current location' }).click();
    await settled(page);
    await find(page, manjeriVenue.name);
    await expect(page.getByText(/km away/)).toHaveCount(0);
  });
});
