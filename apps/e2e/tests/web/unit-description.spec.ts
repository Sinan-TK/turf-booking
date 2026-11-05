import { expect, test } from '../../support/fixtures';

/** The unit's description is typed one point per line by the owner and read as a bullet list by the customer. */
test.describe('customer site: unit description as points', () => {
  test("the picked unit's description is a bullet list, one point per line, and another unit shows its own", async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    const set = await ownerApi.patch(`/resources/${venue.turfId}/description`, {
      data: { description: 'Floodlit 5-a-side turf\n\n- Rubber surface, bring your own shoes\n• Changing rooms and parking\n' },
    });
    expect(set.ok()).toBe(true);
    await ownerApi.patch(`/resources/${venue.courtId}/description`, { data: { description: 'Wooden indoor court' } });

    await page.goto(`/book/${venue.facilityCode}/${venue.turfId}`);
    const list = page.getByRole('list', { name: `About ${venue.turfName}` });
    await expect(list.getByRole('listitem')).toHaveText(['Floodlit 5-a-side turf', 'Rubber surface, bring your own shoes', 'Changing rooms and parking']);

    await page.goto(`/book/${venue.facilityCode}/${venue.courtId}`);
    await expect(page.getByRole('list', { name: `About ${venue.courtName}` }).getByRole('listitem')).toHaveText(['Wooden indoor court']);
    await expect(page.getByText('Floodlit 5-a-side turf')).toHaveCount(0);
  });
});
