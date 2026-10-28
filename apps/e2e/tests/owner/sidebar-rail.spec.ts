import { expect, test } from '../../support/fixtures';

test.describe('owner portal: slim sidebar and the walk-in button', () => {
  test('the sidebar is a slim icon rail that opens while the pointer is over it and closes after a click', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/dashboard');
    const rail = page.locator('aside');
    const label = rail.getByText('Earnings', { exact: true });

    // Collapsed: only the icons show, and the page is not pushed aside.
    expect((await rail.boundingBox())!.width).toBeLessThan(100);
    await expect(label).toHaveCSS('opacity', '0');

    // Hover opens it over the page.
    await rail.hover();
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(200);
    await expect(label).toHaveCSS('opacity', '1');

    // Choosing a page closes it again even though the pointer is still over it.
    await rail.getByRole('link', { name: 'Earnings' }).click();
    await expect(page).toHaveURL(/\/earnings$/);
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(100);

    // Moving away and back opens it again.
    await page.mouse.move(700, 400);
    await rail.hover();
    await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(200);
  });

  test('the Bookings list has a Walk-in booking button that opens the walk-in form', async ({ page }) => {
    await page.goto('/bookings');
    await page.getByRole('main').getByRole('link', { name: /Walk-in booking/ }).click();
    await expect(page).toHaveURL(/\/walk-in$/);
    await expect(page.getByRole('heading', { name: 'Walk-in booking' })).toBeVisible();
  });
});
