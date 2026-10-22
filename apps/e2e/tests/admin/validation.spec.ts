import { expect, test } from '../../support/fixtures';

/** Forms check their fields in the browser first and show a message under each one that is wrong. */
test.describe('admin: field errors on forms', () => {
  test('announcements: title, message and (for selected owners) the recipients are checked', async ({ page }) => {
    await page.goto('/announcements');
    const send = page.getByRole('button', { name: 'Send Announcement' });
    await send.click();
    await expect(page.getByText('Enter the title.')).toBeVisible();
    await expect(page.getByText('Enter the message.')).toBeVisible();

    await page.getByLabel('Title', { exact: true }).fill('PW notice');
    await expect(page.getByText('Enter the title.')).toHaveCount(0);

    await page.getByLabel('Selected Owners').check();
    await page.getByLabel('Message').fill('PW message');
    await send.click();
    await expect(page.getByText('Choose at least one owner, or send to all owners.')).toBeVisible();
    await expect(page.getByText('Enter the message.')).toHaveCount(0);
  });

  test('locations: a district needs a name and a code of at most 10 characters', async ({ page }) => {
    await page.goto('/locations');
    await page.locator('select').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Add District' }).click();
    await expect(page.getByText('Enter the district name.')).toBeVisible();
    await expect(page.getByText('Enter the district code, like MPM.')).toBeVisible();

    await page.getByLabel('District Name').fill('PW District');
    await page.getByLabel(/District Code/).fill('ABCDEFGHIJK');
    await page.getByRole('button', { name: 'Add District' }).click();
    await expect(page.getByText('The code can be at most 10 characters.')).toBeVisible();
    await expect(page.getByText('Enter the district name.')).toHaveCount(0);
  });

  test('owners: a new organization needs a name, a valid email and a phone number', async ({ page }) => {
    await page.goto('/owners');
    await page.getByRole('button', { name: /New organization|Add organization|New owner/i }).first().click();
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText('Enter the organization name.')).toBeVisible();
    await expect(page.getByText('Enter the contact email.')).toBeVisible();
    await expect(page.getByText('Enter the contact phone.')).toBeVisible();

    await page.getByLabel('Contact email').fill('nope');
    await page.getByLabel('Contact phone').fill('12');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText(/Enter a valid email address/)).toBeVisible();
    await expect(page.getByText('Enter a full phone number, like +91 98765 43210.')).toBeVisible();
  });

  test('policies: refund tiers and the commission value are range-checked', async ({ page }) => {
    await page.goto('/policies');
    await page.getByPlaceholder('Refund %').fill('150');
    await page.getByRole('button', { name: 'Create Policy' }).click();
    await expect(page.getByText('Refund % must be between 0 and 100.')).toBeVisible();

    await page.getByRole('button', { name: 'Create Commission' }).click();
    await expect(page.getByText('Enter the value.')).toBeVisible();
    await page.getByLabel(/^Value/).fill('120');
    await page.getByRole('button', { name: 'Create Commission' }).click();
    await expect(page.getByText('Value must be between 0 and 100.')).toBeVisible();
  });
});
