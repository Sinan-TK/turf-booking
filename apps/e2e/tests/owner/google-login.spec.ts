import { URLS, unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { createStaff } from '../../support/staff';

// Starts signed out; the apps run in test-Google mode (a labelled form stands in for Google's button).
test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.owner });

async function googleSignIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Test Google email').fill(email);
  await page.getByLabel('Test Google name').fill('PW Google Staff');
  await page.getByRole('button', { name: 'Continue with Google (test)' }).click();
}

test.describe('owner portal: Google sign-in', () => {
  test('an invited staff member signs in with Google and stays limited to their venue', async ({ page, ownerApi, venue }) => {
    const staff = await createStaff(ownerApi, [venue.id], 'GoogleStaff');
    await googleSignIn(page, staff.email);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(venue.name).first()).toBeVisible();
  });

  test('an address that was never invited stays signed out with an explanation', async ({ page }) => {
    await googleSignIn(page, `pw-stranger-${unique()}@example.com`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/hasn.t been invited/i)).toBeVisible();
  });
});
