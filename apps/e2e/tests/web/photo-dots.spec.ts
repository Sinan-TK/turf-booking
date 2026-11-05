import { expect, test } from '../../support/fixtures';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A unit with several photos: dots at the bottom left of the big picture switch between them, and there is no strip of previews below. */
test.describe('customer site: unit photos as dots', () => {
  test('two photos show two dots on the big picture, tapping one changes the photo, and no thumbnails sit below', async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    for (const name of ['a.png', 'b.png']) {
      const up = await ownerApi.post(`/resources/${venue.turfId}/photos`, { multipart: { file: { name, mimeType: 'image/png', buffer: PNG } } });
      expect(up.ok()).toBe(true);
    }
    await page.goto(`/book/${venue.facilityCode}/${venue.turfId}`);
    const dots = page.getByRole('group', { name: 'Photos' }).getByRole('button');
    await expect(dots).toHaveCount(2);
    const first = page.locator('img[alt$="' + venue.turfName + '"]').first();
    const before = await first.getAttribute('src');
    await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
    await dots.nth(1).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => page.locator('img[alt$="' + venue.turfName + '"]').first().getAttribute('src')).not.toBe(before);
    // No strip of small previews: the only images in the picture area are the big one.
    await expect(page.locator('button[aria-label^="Photo "] img')).toHaveCount(0);
  });

  test('one photo shows no dots', async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    await ownerApi.post(`/resources/${venue.courtId}/photos`, { multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: PNG } } });
    await page.goto(`/book/${venue.facilityCode}/${venue.courtId}`);
    await expect(page.getByRole('group', { name: 'Photos' })).toHaveCount(0);
  });
});
