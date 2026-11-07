import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';
import { openSection, openUnitTab } from '../../support/ui';

/**
 * A pooled item (a kayak fleet) is added on the venue's page with its count and fixed times, priced per kayak, and then listed to
 * customers with a quantity picker that stops at what is left.
 */
test.describe('owner portal: pooled items', () => {
  test('add a fleet with fixed slots (from, to, how many, price), change the count; a customer can then pick how many', async ({ page, makeVenue, ownerApi, browser }) => {
    test.setTimeout(150_000);
    const venue = await makeVenue();
    // The slot lengths must be ones the facility allows, which the Super Admin can change: read them instead of assuming one hour.
    const kayak = ((await (await ownerApi.get('/categories')).json()) as Array<{ slug: string; policy: { durations: number[] } }>).find((c) => c.slug === 'KAYAKING')!;
    const [lenA = 60, lenB = lenA] = kayak.policy.durations;
    const clock12 = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${Math.floor(minutes / 60) % 24 < 12 ? 'AM' : 'PM'}`;
    const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const lengthText = (minutes: number) => (minutes % 60 === 0 ? (minutes === 60 ? '1 hour' : `${minutes / 60} hours`) : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`);
    const slotA = { start: 8 * 60, end: 8 * 60 + lenA }; // 8:00 am for the shortest length
    const slotB = { start: 12 * 60, end: 12 * 60 + lenB };
    const labelA = `${clock12(slotA.start)} – ${clock12(slotA.end)}`;
    const labelB = `${clock12(slotB.start)} – ${clock12(slotB.end)}`;
    await page.goto(`/venues/${venue.id}`);

    // Add the pooled item on the New tab: facility, name, count, fixed slots.
    await openUnitTab(page, 'New');
    const section = page.getByRole('heading', { name: 'Add a pooled item' }).locator('xpath=ancestor::section[1]');
    await section.getByLabel('Facility').selectOption({ label: 'Kayaking' });
    await section.getByRole('button', { name: 'Add pooled item' }).click();
    await expect(section.getByText('Enter a name.')).toBeVisible();
    await expect(section.getByText(/Enter how many/)).toBeVisible();
    await section.getByLabel('Name').fill('PW Single kayaks');
    await section.getByLabel(/How many/).fill('6');
    await section.getByText('Fixed slots only').click();
    await section.getByRole('button', { name: 'Add pooled item' }).click();
    await expect(section.getByText('Add at least one slot.')).toBeVisible();
    // Each slot: from, to, how many, price for one, pay online for one.
    const fill = async (row: number, v: { start: string; end: string; count: string; price: string; advance: string }) => {
      await section.locator(`#pool-new-${row}-start`).fill(v.start);
      await section.locator(`#pool-new-${row}-end`).fill(v.end);
      await section.locator(`#pool-new-${row}-count`).fill(v.count);
      await section.locator(`#pool-new-${row}-price`).fill(v.price);
      await section.locator(`#pool-new-${row}-advance`).fill(v.advance);
    };
    await section.getByRole('button', { name: 'Add slot' }).click();
    await fill(0, { start: hhmm(slotA.start), end: hhmm(slotA.end), count: '5', price: '400', advance: '200' });
    await section.getByRole('button', { name: 'Add slot' }).click();
    await fill(1, { start: hhmm(slotB.start), end: hhmm(slotB.end), count: '6', price: '550', advance: '300' });
    await expect(section.getByText(lengthText(lenB)).first()).toBeVisible(); // the row says how long it runs
    await section.getByRole('button', { name: 'Add pooled item' }).click();

    // Its own tab opens, with its card.
    const card = page.getByRole('region', { name: 'PW Single kayaks' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('6 kayaks');
    await expect(card).toContainText('fixed slots');
    // The slots were saved as typed, each with its own count and price.
    await expect(card.locator('input[id$="-0-count"]')).toHaveValue('5');
    await expect(card.locator('input[id$="-1-price"]')).toHaveValue('550');

    // Change the count.
    await card.locator('input[id^="count-"]').fill('8');
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
    // Each slot is a time range with its own count.
    await expect(article.getByRole('button', { name: new RegExp('^' + labelA) })).toContainText('5 left');
    await expect(article.getByRole('button', { name: new RegExp('^' + labelB) })).toContainText('6 left');
    await expect(article.locator('img[alt$="PW Single kayaks"]').first()).toBeAttached(); // its own photo is the big picture
    await article.getByRole('button', { name: new RegExp('^' + labelA) }).click();
    await expect(article.getByText('How many kayaks')).toBeVisible();
    await article.getByRole('button', { name: 'More kayaks' }).click();
    await article.getByRole('button', { name: 'More kayaks' }).click();
    await expect(article.getByRole('button', { name: /^Book 8:00 AM · 3 kayaks/ })).toBeVisible();
    await expect(article.getByText('₹1,200').first()).toBeVisible(); // 3 x 400, the slot's own price
    await expect(article.getByRole('button', { name: 'More kayaks' })).toBeEnabled();
    // The most that can be picked is what the slot offers: 5.
    const more = article.getByRole('button', { name: 'More kayaks' });
    while (await more.isEnabled()) await more.click();
    await expect(article.getByRole('button', { name: 'More kayaks' })).toBeDisabled();
    // The other slot has its own price.
    await article.getByRole('button', { name: new RegExp('^' + labelB) }).click();
    await article.getByRole('button', { name: 'More kayaks' }).click();
    await expect(article.getByText('₹1,100').first()).toBeVisible(); // 2 x 550
    await customer.close();
  });

  test('a pooled item has its own closed days: added on its tab, listed there only, and removable', async ({ page, makeVenue, ownerApi }) => {
    test.setTimeout(120_000);
    const venue = await makeVenue();
    const kayak = ((await (await ownerApi.get('/categories')).json()) as Array<{ id: string; slug: string }>).find((c) => c.slug === 'KAYAKING')!;
    const made = await ownerApi.post('/resources/groups', { data: { venueId: venue.id, categoryId: kayak.id, name: 'PW Closed kayaks', allocationMode: 'POOLED', totalUnits: 4, sortOrder: 0 } });
    expect(made.ok()).toBeTruthy();
    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, 'PW Closed kayaks');
    const closed = page.getByRole('heading', { name: 'Closed Days' }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    await expect(closed).toContainText('PW Closed kayaks');
    await closed.getByLabel('Date').fill('2031-06-06');
    await closed.getByLabel('Reason (optional)').fill('PW Rough water');
    await closed.getByRole('button', { name: 'Close This Day' }).click();
    await expect(closed.getByText('PW Rough water')).toBeVisible();

    // It belongs to the pooled item only: not on the venue's own list, nor a unit's.
    await openSection(page, 'Venue');
    await expect(page.getByText('PW Rough water')).toHaveCount(0);
    await openUnitTab(page, venue.turfName);
    await page.getByRole('tab', { name: 'Closed days' }).click();
    await expect(page.getByText('PW Rough water')).toHaveCount(0);

    await openUnitTab(page, 'PW Closed kayaks');
    await closed.getByRole('button', { name: 'Remove' }).click();
    await expect(closed.getByText('PW Rough water')).toHaveCount(0);
  });

  test('a pooled item price takes any days, picked like a normal unit (not only every day, weekdays or weekends)', async ({ page, makeVenue, ownerApi }) => {
    test.setTimeout(120_000);
    const venue = await makeVenue();
    const kayak = ((await (await ownerApi.get('/categories')).json()) as Array<{ id: string; slug: string }>).find((c) => c.slug === 'KAYAKING')!;
    const made = await ownerApi.post('/resources/groups', { data: { venueId: venue.id, categoryId: kayak.id, name: 'PW Days kayaks', allocationMode: 'POOLED', totalUnits: 4, sortOrder: 0 } });
    expect(made.ok(), await made.text()).toBeTruthy();
    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, 'PW Days kayaks');
    const card = page.getByRole('region', { name: 'PW Days kayaks' });
    // Prices are added in a modal, like a normal unit's.
    await card.getByRole('button', { name: 'Add price' }).click();
    const modal = page.getByRole('dialog', { name: 'Add a price' });
    const days = modal.getByRole('group', { name: 'Days this price applies to' });

    // No day chosen is refused with a message.
    await days.getByRole('button', { name: 'Monday' }).click();
    await days.getByRole('button', { name: 'Tuesday' }).click();
    await days.getByRole('button', { name: 'Wednesday' }).click();
    await days.getByRole('button', { name: 'Thursday' }).click();
    await days.getByRole('button', { name: 'Friday' }).click();
    await days.getByRole('button', { name: 'Saturday' }).click();
    await days.getByRole('button', { name: 'Sunday' }).click();
    await modal.getByLabel('Price for one').fill('300');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal.getByText('Choose at least one day.')).toBeVisible();

    // Friday to Sunday is a choice no fixed list had.
    await days.getByRole('button', { name: 'Friday' }).click();
    await days.getByRole('button', { name: 'Saturday' }).click();
    await days.getByRole('button', { name: 'Sunday' }).click();
    await expect(days.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true');
    await modal.getByRole('button', { name: 'Add price' }).click();
    await expect(modal).toHaveCount(0);
    await expect(card.getByText(/Fri–Sun/)).toBeVisible();

    // Listed like a unit's prices, in a table with edit, block and remove.
    const row = card.getByRole('row', { name: /Fri–Sun/ });
    await expect(row).toContainText('Active');
    await expect(row).toContainText('INR 300');

    // Edit: change the days and the price.
    await row.getByRole('button', { name: 'Edit price' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit price' });
    await expect(edit.getByLabel('Price for one')).toHaveValue('300');
    await expect(edit.getByRole('button', { name: 'Friday' })).toHaveAttribute('aria-pressed', 'true');
    await edit.getByRole('button', { name: 'Friday' }).click();
    await edit.getByLabel('Price for one').fill('350');
    await edit.getByLabel('Pay online (one)').fill('350');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(edit).toHaveCount(0);
    const edited = card.getByRole('row', { name: /Sat, Sun/ });
    await expect(edited).toContainText('INR 350');

    // Block keeps it in the list but off; unblock turns it back on.
    await edited.getByRole('button', { name: 'Block price' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Block price' }).click();
    await expect(edited).toContainText('Blocked');
    await edited.getByRole('button', { name: 'Unblock price' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Unblock price' }).click();
    await expect(edited).toContainText('Active');

    // Remove.
    await edited.getByRole('button', { name: 'Remove price' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove price' }).click();
    await expect(card.getByRole('row', { name: /Sat, Sun/ })).toHaveCount(0);
  });

  test('a facility with pooled stock is not offered in the unit form', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, 'New');
    const options = await page.locator('#unit-categoryId option').allTextContents();
    expect(options).not.toContain('Kayaking');
  });
});
