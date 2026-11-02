import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';

/**
 * A pooled item (a kayak fleet) is added on the venue's page with its count and fixed times, priced per kayak, and then listed to
 * customers with a quantity picker that stops at what is left.
 */
test.describe('owner portal: pooled items', () => {
  test('add a fleet with a count and fixed times, price it, change the count; a customer can then pick how many', async ({ page, makeVenue, ownerApi, browser }) => {
    test.setTimeout(150_000);
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);

    // Add the pooled item: facility, name, count, fixed times.
    const section = page.getByRole('heading', { name: 'Add a pooled item' }).locator('xpath=ancestor::section[1]');
    await section.getByLabel('Facility').selectOption({ label: 'Kayaking' });
    await section.getByRole('button', { name: 'Add pooled item' }).click();
    await expect(section.getByText('Enter a name.')).toBeVisible();
    await expect(section.getByText(/Enter how many/)).toBeVisible();
    await section.getByLabel('Name').fill('PW Single kayaks');
    await section.getByLabel(/How many/).fill('6');
    await section.getByText('Fixed times only').click();
    await section.getByRole('button', { name: 'Add pooled item' }).click();
    await expect(section.getByText('Add at least one departure time.')).toBeVisible();
    for (const time of ['10:00', '08:00']) {
      await section.getByLabel('Departure time').fill(time);
      await section.getByRole('button', { name: 'Add time' }).click();
    }
    await section.getByRole('button', { name: 'Add pooled item' }).click();

    const card = page.getByRole('region', { name: 'PW Single kayaks' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('6 kayaks');
    await expect(card).toContainText('fixed times');

    // Price per kayak (one hour, 6 am to 6 pm by default).
    await card.getByLabel('Price for one').fill('400');
    await card.getByRole('button', { name: 'Add price' }).click();
    await expect(card).toContainText('INR 400 per kayak');

    // Change the count.
    await card.getByLabel(/How many kayaks/).fill('8');
    await card.getByRole('button', { name: 'Save count' }).click();
    await expect(card).toContainText('8 kayaks');

    // The card has its own photo editor, and a photo added there is what customers see.
    await expect(card.getByRole('button', { name: /Add photo/ })).toBeVisible();
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const groupsNow = (await (await ownerApi.get(`/resources/groups?venueId=${venue.id}`)).json()) as Array<{ id: string; name: string }>;
    const uploaded = await ownerApi.post(`/resources/groups/${groupsNow.find((g) => g.name === 'PW Single kayaks')!.id}/photos`, { multipart: { file: { name: 'k.png', mimeType: 'image/png', buffer: PNG } } });
    expect(uploaded.ok()).toBeTruthy();

    // What customers get: the fleet is in the search with a free count at each fixed time.
    const groups = (await (await ownerApi.get(`/resources/groups?venueId=${venue.id}`)).json()) as Array<{ id: string; name: string }>;
    const group = groups.find((g) => g.name === 'PW Single kayaks')!;
    const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    const customer = await browser.newContext({ baseURL: URLS.web });
    const web = await customer.newPage();
    await web.goto(`/book/${venue.facilityCode}/${group.id}?date=${day}`);
    const article = web.getByRole('article').first();
    await expect(article.getByRole('heading', { level: 1 })).toContainText(venue.name);
    await expect(article.getByText('8 left').first()).toBeVisible();
    await expect(article.locator('img[alt$="PW Single kayaks"]').first()).toBeAttached(); // its own photo is the big picture
    await article.getByRole('button', { name: /^8:00 AM/ }).click();
    await expect(article.getByText('How many kayaks')).toBeVisible();
    await article.getByRole('button', { name: 'More kayaks' }).click();
    await article.getByRole('button', { name: 'More kayaks' }).click();
    await expect(article.getByRole('button', { name: /^Book 8:00 AM · 3 kayaks/ })).toBeVisible();
    await expect(article.getByText('INR 1,200').or(article.getByText('₹1,200')).first()).toBeVisible(); // 3 x 400
    await customer.close();
  });

  test('a facility with pooled stock is not offered in the unit form', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    const options = await page.locator('#unit-categoryId option').allTextContents();
    expect(options).not.toContain('Kayaking');
  });
});
