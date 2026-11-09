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
    await expect(page.getByText('Enter the full 10-digit mobile number.')).toBeVisible();
    await page.getByLabel('Contact phone').fill('5876543210');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText('Indian mobile numbers start with 6, 7, 8 or 9.')).toBeVisible();
  });

  test('commercial terms: percentages, shares and tiers are checked before anything is sent', async ({ page }) => {
    await page.goto('/policies');
    await expect(page.getByRole('heading', { name: 'Commission', level: 3 })).toBeVisible();

    await page.getByLabel('Minimum advance').fill('150');
    await page.getByLabel('Window 1 customer share').fill('80');
    await page.getByLabel('Window 1 owner share').fill('40');
    await page.getByLabel('Fee after the cap').fill('-1');
    await page.getByLabel('Tier 1 value').fill('');
    await page.getByRole('button', { name: 'Save terms' }).click();

    await expect(page.getByText('The minimum advance must be between 0 and 100.')).toBeVisible();
    await expect(page.getByText('Window 1: the customer and owner shares add up to more than 100%.')).toBeVisible();
    await expect(page.getByText('The after-cap fee must be between 0 and 100.')).toBeVisible();
    await expect(page.getByText('Tier 1: enter the commission.')).toBeVisible();
    await expect(page.getByText(/^Saved\./)).toHaveCount(0);
  });

  test('commercial terms: the platform share of a cancellation window is shown and editable', async ({ page }) => {
    await page.goto('/policies');
    await page.getByLabel('Window 1 customer share').fill('50');
    await page.getByLabel('Window 1 owner share').fill('30');
    await expect(page.getByLabel('Window 1 platform share')).toHaveValue('20');
    await expect(page.getByText('Customer 50% · Owner 30% · Platform 20%')).toBeVisible();
    // Raising the platform's share takes it out of the owner's.
    await page.getByLabel('Window 1 platform share').fill('35');
    await expect(page.getByLabel('Window 1 owner share')).toHaveValue('15');
    await expect(page.getByText('Customer 50% · Owner 15% · Platform 35%')).toBeVisible();
  });

  test('commercial terms: customer cancellation has an on/off switch', async ({ page }) => {
    await page.goto('/policies');
    const sw = page.getByRole('switch', { name: 'Allow customers to cancel' });
    await expect(sw).toBeChecked();
    await expect(page.getByText('On: the cancellation windows apply')).toBeVisible();
    await sw.uncheck();
    await expect(page.getByText('Off: no cancellation is available')).toBeVisible();
    await sw.check();
    await expect(page.getByText('On: the cancellation windows apply')).toBeVisible();
  });

  test('commercial terms: the server refuses a commission above the minimum advance', async ({ page }) => {
    await page.goto('/policies');
    await page.getByLabel('Minimum advance').fill('10');
    await page.getByLabel('Tier 1 type').selectOption('PERCENTAGE');
    await page.getByLabel('Tier 1 value').fill('30');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/can't be more than the minimum online advance/)).toBeVisible();
  });
});
