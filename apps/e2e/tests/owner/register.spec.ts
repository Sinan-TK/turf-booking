import { expect, test, type Page } from '@playwright/test';
import { URLS } from '../../support/env';

// These tests are about the pages a new owner sees, so they start signed out.
test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.owner });

const cors = { 'content-type': 'application/json', 'access-control-allow-origin': URLS.owner, 'access-control-allow-credentials': 'true' };

/** Fills the first two steps and stops on the review. */
async function fillAndReachReview(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Asha Menon');
  await page.getByLabel('Email').fill('asha@example.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Business or venue name').fill('PW Sports Hub');
  await page.getByLabel('Mobile number').fill('9847012345');
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** The owner portal's sign-up page and the Venue Partner Terms. The server's answer is supplied, so no real email is sent. */
test.describe('owner portal: creating an account', () => {
  test('the sign-in page offers it, and the sign-up goes step by step, checking each step before moving on', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create an owner account' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'List your venue' })).toBeVisible();
    const progress = page.getByRole('list', { name: 'Sign-up progress' });
    await expect(progress.getByRole('listitem')).toHaveCount(3);
    await expect(progress.locator('[aria-current="step"]')).toContainText('About you');
    await expect(page.getByText('Step 1 of 3')).toBeVisible();

    // Step 1 will not move on until it is right; the cursor lands on the first problem.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toBeFocused();
    await page.getByLabel('Your name').fill('Asha Menon');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/valid email address/)).toBeVisible();
    await page.getByLabel('Email').fill('asha@example.com');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 2.
    await expect(progress.locator('[aria-current="step"]')).toContainText('Business');
    await expect(page.getByText('Step 2 of 3')).toBeVisible();
    await expect(page.getByLabel('Business or venue name')).toBeFocused();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter the business or venue name.')).toBeVisible();
    await expect(page.getByText('Enter your mobile number.')).toBeVisible();
    // Back keeps what was typed.
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByLabel('Your name')).toHaveValue('Asha Menon');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Business or venue name').fill('PW Sports Hub');
    await page.getByLabel('Mobile number').fill('9847012345');
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3: a review, with a way back to change each part, and the terms.
    await expect(progress.locator('[aria-current="step"]')).toContainText('Review');
    await expect(page.getByText('PW Sports Hub')).toBeVisible();
    await expect(page.getByText('asha@example.com')).toBeVisible();
    await expect(page.getByText('+91 98470 12345')).toBeVisible();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Please accept the Venue Partner Terms to continue.')).toBeVisible();
    await page.getByRole('button', { name: 'Change business or venue' }).click();
    await expect(page.getByLabel('Business or venue name')).toHaveValue('PW Sports Hub');

    // The terms are readable before an account exists, from the owner portal itself.
    await page.getByRole('button', { name: 'Continue' }).click();
    const terms = page.getByRole('link', { name: 'Venue Partner Terms' });
    await expect(terms).toHaveAttribute('href', '/partner-terms');
    await expect(terms).toHaveAttribute('target', '_blank');
  });

  test('a complete form sends the details, never a password, and says what happens next', async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route(`${URLS.api}/auth/owner/register`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 202, headers: cors, body: '{"ok":true}' });
    });
    await fillAndReachReview(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(/We sent a link to asha@example.com/)).toBeVisible();
    for (const step of ['Open the email', 'Choose your password', 'Add your venue']) await expect(page.getByText(step)).toBeVisible();
    expect(sent).toEqual({ businessName: 'PW Sports Hub', name: 'Asha Menon', email: 'asha@example.com', phone: '9847012345', acceptTerms: true });
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  test('too many sign-ups says so, and the review stays as it was', async ({ page }) => {
    await page.route(`${URLS.api}/auth/owner/register`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 429, headers: cors, body: '{"message":"Too many requests"}' });
    });
    await fillAndReachReview(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/Too many sign-up attempts/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible(); // still on the review step, nothing lost
    await expect(page.getByText('PW Sports Hub')).toBeVisible();
  });

  test('the Venue Partner Terms are public on the owner portal, dated, with contents, and link to the customer site policies', async ({ page }) => {
    await page.goto('/partner-terms');
    await expect(page.getByRole('heading', { name: 'Venue Partner Terms', level: 1 })).toBeVisible();
    await expect(page.getByText(/Last updated \d+ \w+ \d{4}/)).toBeVisible();
    const toc = page.getByRole('navigation', { name: 'On this page' });
    expect(await toc.getByRole('link').count()).toBeGreaterThan(5);
    await expect(page.getByRole('heading', { name: 'Commission and payouts' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', /\/privacy$/);
  });
});
