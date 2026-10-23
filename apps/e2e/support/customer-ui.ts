import { expect, type BrowserContext, type Page } from '@playwright/test';

/** Points the browser's location at a spot, so the site's "Use my current location" finds venues there. */
export async function shareLocation(context: BrowserContext, lat: number, lng: number): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: lat, longitude: lng });
}

/** Opens the location picker and uses the browser's (faked) location. */
export async function searchNear(page: Page, venueName: string): Promise<void> {
  await page.goto('/');
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
