import { expect, test } from '../../support/fixtures';

/** A featured venue's card on the landing page opens that venue's own page. */
test.describe('customer site: featured venues', () => {
  test('clicking a featured card opens the venue page for booking', async ({ page, adminApi, venue }) => {
    const before = ((await (await adminApi.get('/admin/site')).json()) as { featured: Array<{ id: string }> }).featured.map((f) => f.id);
    try {
      await adminApi.put('/admin/site/featured', { data: { venueIds: [venue.id] } });
      await page.goto('/');
      const card = page.getByRole('region', { name: 'Featured venues' }).getByRole('link', { name: new RegExp(venue.name) });
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute('href', `/book/${venue.facilityCode}/any`);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/book/${venue.facilityCode}/`));
      await expect(page.getByRole('article', { name: `Book ${venue.name}` })).toBeVisible({ timeout: 30_000 });
    } finally {
      await adminApi.put('/admin/site/featured', { data: { venueIds: before } });
    }
  });
});
