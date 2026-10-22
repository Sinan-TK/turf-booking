import { expect, type BrowserContext, type Page } from '@playwright/test';
import { plantLoginCode } from './customer';

/** Points the browser's location at a spot, so the site's "Use my current location" finds venues there. */
export async function shareLocation(context: BrowserContext, lat: number, lng: number): Promise<void> {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: lat, longitude: lng });
}

/** Opens the location picker and uses the browser's (faked) location. */
export async function searchNear(page: Page, venueName: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Select Location/ }).click();
  await page.getByRole('button', { name: 'Use my current location' }).click();
  await expect(page.getByRole('heading', { name: venueName }).first()).toBeVisible({ timeout: 30_000 });
  await settled(page);
}

/** Waits for the results to finish loading (the site keeps the old results on screen while it re-checks availability). */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByText('Checking live availability…')).toHaveCount(0, { timeout: 60_000 });
}

/** Logs in through the real dialog: phone, a planted one-time code (see support/customer.ts), then the name step. */
export async function logIn(page: Page, phone: string, name = 'PW Customer'): Promise<void> {
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByPlaceholder('98765 43210').fill(phone.slice(3)); // national number, without +91
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = page.getByPlaceholder('000000');
  await expect(code).toBeVisible();
  await plantLoginCode(phone);
  await code.fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  const nameDialog = page.getByRole('dialog', { name: 'What should we call you?' });
  await expect(nameDialog).toBeVisible();
  await nameDialog.getByRole('textbox').fill(name);
  await nameDialog.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
