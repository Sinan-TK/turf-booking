import { expect, test } from '@playwright/test';
import { URLS } from '../../support/env';

// These tests are about the pages a new owner sees, so they start signed out.
test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.owner });

/** The owner portal's sign-up page and the Venue Partner Terms. The server's answer is supplied, so no real email is sent. */
test.describe('owner portal: creating an account', () => {
  test('the sign-in page offers it, and the page asks for what it needs and for agreement to the terms', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Create an owner account' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'List your venue' })).toBeVisible();

    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter the business or venue name.')).toBeVisible();
    await expect(page.getByText('Enter your name.')).toBeVisible();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText(/Enter .*mobile number/)).toBeVisible();
    await expect(page.getByText('Please accept the Venue Partner Terms to continue.')).toBeVisible();

    // The terms are readable before an account exists, from the owner portal itself.
    const terms = page.getByRole('link', { name: 'Venue Partner Terms' });
    await expect(terms).toHaveAttribute('href', '/partner-terms');
    await expect(terms).toHaveAttribute('target', '_blank');
  });

  test('a complete form sends the details, never a password, and says to check the email', async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route(`${URLS.api}/auth/owner/register`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 202, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.owner, 'access-control-allow-credentials': 'true' }, body: '{"ok":true}' });
    });
    await page.goto('/register');
    await page.getByLabel('Business or venue name').fill('PW Sports Hub');
    await page.getByLabel('Your name').fill('Asha Menon');
    await page.getByLabel('Email').fill('asha@example.com');
    await page.getByLabel('Mobile number').fill('9847012345');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText('asha@example.com')).toBeVisible();
    expect(sent).toEqual({ businessName: 'PW Sports Hub', name: 'Asha Menon', email: 'asha@example.com', phone: '9847012345', acceptTerms: true });
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  test('too many sign-ups says so, and the form stays', async ({ page }) => {
    await page.route(`${URLS.api}/auth/owner/register`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.owner, 'access-control-allow-credentials': 'true' }, body: '{"message":"Too many requests"}' });
    });
    await page.goto('/register');
    await page.getByLabel('Business or venue name').fill('PW Sports Hub');
    await page.getByLabel('Your name').fill('Asha Menon');
    await page.getByLabel('Email').fill('asha@example.com');
    await page.getByLabel('Mobile number').fill('9847012345');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText(/Too many sign-up attempts/)).toBeVisible();
    await expect(page.getByLabel('Business or venue name')).toHaveValue('PW Sports Hub');
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
