import { expect, test } from '../../support/fixtures';

test.describe('owner portal: advance booking', () => {
  test('a venue starts at 14 days and the owner can change it to anything from 1 to 14', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: 'Advance booking' })).toBeVisible();
    await expect(page.getByText('Customers can book up to 14 days ahead: today and the next 13 days.')).toBeVisible();

    await page.getByRole('button', { name: 'Change', exact: true }).click();
    const select = page.getByLabel('Customers can book up to');
    await expect(select.locator('option')).toHaveCount(14); // 1 to 14, nothing beyond
    await expect(select).toHaveValue('14');
    await select.selectOption('7');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Customers can book up to 7 days ahead: today and the next 6 days.')).toBeVisible();

    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByLabel('Customers can book up to').selectOption('1');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Customers can book up to 1 day ahead: today only.')).toBeVisible();

    // It sticks.
    await page.reload();
    await expect(page.getByText('Customers can book up to 1 day ahead: today only.')).toBeVisible();
  });
});
