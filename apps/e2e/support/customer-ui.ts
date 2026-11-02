import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Points the browser's location at a spot, so the site's "Use my current location" finds venues there. */
export async function shareLocation(context: BrowserContext, lat: number, lng: number): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: lat, longitude: lng });
}

/** Opens the location picker and uses the browser's (faked) location. */
export async function searchNear(page: Page, venueName: string): Promise<void> {
  await page.goto('/explore');
  await page.getByRole('button', { name: /Change location/ }).click();
  await page.getByRole('dialog', { name: 'Choose your location' }).getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByRole('heading', { name: venueName }).first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
}

/** Waits for the results to finish loading (the site keeps the old results on screen while it re-checks availability). */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByText('Checking live availability…')).toHaveCount(0, { timeout: 60_000 });
}

/**
 * Logs in through the real dialog using the test Google sign-in (the apps run with NEXT_PUBLIC_GOOGLE_AUTH_MODE=fake and
 * the API with GOOGLE_AUTH_MODE=fake), then the profile step: name and phone. The email is derived from the phone, so a
 * given phone always signs in as the same customer.
 */
export async function logIn(page: Page, phone: string, name = 'PW Customer'): Promise<void> {
  await page.getByRole('button', { name: 'Log in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Test Google email').fill(`pw${phone.replace(/\D/g, '')}@example.com`);
  await dialog.getByLabel('Test Google name').fill(name);
  await dialog.getByRole('button', { name: 'Continue with Google (test)' }).click();

  const nameField = dialog.getByLabel('Your name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  const phoneField = dialog.getByLabel('Phone number');
  if (await phoneField.isVisible()) await phoneField.fill(phone.slice(3)); // national number, without +91
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Opens the venue's booking window ("Book Now" on its card), optionally on one of its units' tabs first. */
export async function openBooking(page: Page, venueName: string, unitName?: string) {
  const card = page.locator('article').filter({ hasText: venueName });
  if (unitName) await card.getByRole('tab', { name: new RegExp('^' + unitName) }).click();
  await card.getByRole('link', { name: 'Book Now' }).click();
  await expect(page).toHaveURL(/\/book\//);
  const window = page.getByRole('article', { name: 'Book ' + venueName });
  await expect(window).toBeVisible();
  return window;
}

/** Opens the venue-type picker (the "Venue types" button in the header) and returns it. */
export async function openVenueTypes(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Venue types' }).click();
  const picker = page.getByRole('dialog', { name: 'Venue types' });
  await expect(picker).toBeVisible();
  return picker;
}

/**
 * The listing on a day two days ahead, so the test never depends on the time of day it runs (late in the evening every card for today is sold out
 * and has no Book Now). Waits for the cards of that day.
 */
export async function exploreLaterDay(page: Page): Promise<void> {
  await page.goto('/explore');
  await page.getByRole('button', { name: /^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*\d/ }).nth(2).click();
  await expect(page.getByRole('link', { name: 'Book Now' }).first()).toBeVisible({ timeout: 30_000 });
}
