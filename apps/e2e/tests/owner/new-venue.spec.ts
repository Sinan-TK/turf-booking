import { expect, test } from '../../support/fixtures';
import { unique } from '../../support/env';
import { field } from '../../support/ui';

test.describe('owner portal: new venue form', () => {
  test('has a back link and a progress checklist that follows the form', async ({ page }) => {
    await page.goto('/venues/new');
    await expect(page.getByRole('heading', { name: 'New Venue' })).toBeVisible();
    await expect(page.getByText('0 of 4 done')).toBeVisible();

    await page.getByPlaceholder('e.g. Greenfield Sports Arena').fill('PW checklist');
    await expect(page.getByText('1 of 4 done')).toBeVisible();

    await page.getByRole('link', { name: 'All venues' }).click();
    await expect(page).toHaveURL(/\/venues$/);
  });

  test('each missing field is flagged under itself, and the message clears as it is fixed', async ({ page }) => {
    await page.goto('/venues/new');
    await page.getByRole('button', { name: 'Create Venue' }).click();
    await expect(page.getByText('Enter the venue name.')).toBeVisible();
    await expect(page.getByText('Select a state, then a district.')).toBeVisible();
    await expect(page.getByText('Enter the street address.')).toBeVisible();
    await expect(page.getByText('Enter the latitude.')).toBeVisible();
    await expect(page.getByText('Enter the longitude.')).toBeVisible();
    await expect(page).toHaveURL(/\/venues\/new$/);

    await page.getByPlaceholder('e.g. Greenfield Sports Arena').fill('PW Flagged');
    await expect(page.getByText('Enter the venue name.')).toHaveCount(0);
    await page.getByPlaceholder('10.850500').fill('123');
    await page.getByRole('button', { name: 'Create Venue' }).click();
    await expect(page.getByText('Latitude must be between -90 and 90.')).toBeVisible();
  });

  test('creates a draft venue with no facility or timezone question', async ({ page }) => {
    await page.goto('/venues/new');
    // Nothing asks for a venue type or timezone.
    await expect(page.getByText(/venue type/i)).toHaveCount(0);
    await expect(page.getByText(/^Timezone$/)).toHaveCount(0);

    const name = `PW New ${unique()}`;
    await page.getByPlaceholder('e.g. Greenfield Sports Arena').fill(name);
    await page.getByPlaceholder('A short line about the place (optional)').fill('Made by Playwright');
    await field(page, 'State').selectOption({ index: 1 });
    await expect(field(page, 'District')).toBeEnabled();
    await field(page, 'District').selectOption({ index: 1 });
    await page.getByPlaceholder('Building, street, area').fill('12 Test Road');
    await page.getByPlaceholder('10.850500').fill('11.0510');
    await page.getByPlaceholder('76.271100').fill('76.0711');
    await expect(page.getByText('4 of 4 done')).toBeVisible();

    await page.getByRole('button', { name: 'Create Venue' }).click();
    await expect(page).toHaveURL(/\/venues\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('DRAFT').first()).toBeVisible();
    await page.getByRole('tab', { name: /^Units/ }).click(); // units live on their own tab
    await expect(page.getByText('No units yet')).toBeVisible();
  });
});
