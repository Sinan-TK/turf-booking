import { expect, test } from '../../support/fixtures';

/** The admin detail pages that show long lists page them (and search them): venues of an owner, owners to announce to, units of a venue. */
test.describe('admin: paged lists on detail pages', () => {
  test('an owner page has Bookings, Venues and Logins tabs, each searchable and paged, and Add owner opens a dialog', async ({ page, adminApi, venue }) => {
    const orgId = (await (await adminApi.get(`/venues/${venue.id}`)).json()).organizationId as string;
    await page.goto(`/owners/${orgId}`);
    await expect(page.getByRole('tab', { name: /^Bookings/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /^Venues/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Logins/ })).toBeVisible();

    // Venues: searched and paged.
    await page.getByRole('tab', { name: /^Venues/ }).click();
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
    await page.getByLabel('Search venues', { exact: true }).fill(venue.name);
    await expect(page.locator('a[href="/venues/' + venue.id + '"]')).toHaveCount(1);
    await page.getByLabel('Search venues', { exact: true }).fill('zzz-no-such-venue-zzz');
    await expect(page.getByText('No venues match your search.').first()).toBeVisible();

    // Bookings: searched by the server; the tab says so when nothing matches.
    await page.getByRole('tab', { name: /^Bookings/ }).click();
    await page.getByLabel('Search bookings').fill('zzz-no-such-order-zzz');
    await expect(page.getByText('No bookings match your search.')).toBeVisible();

    // Logins: searched by the server.
    await page.getByRole('tab', { name: /^Logins/ }).click();
    await page.getByLabel('Search logins').fill('zzz-nobody-zzz');
    await expect(page.getByText('No logins match your search.')).toBeVisible();

    // Add owner: a dialog with the form; staff pick venues from a searchable, paged list that keeps the choice.
    await page.getByRole('button', { name: '+ Add owner' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add owner' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Role').selectOption('OWNER_STAFF');
    await dialog.getByLabel('Search venues to assign').fill(venue.name);
    await dialog.getByRole('checkbox', { name: venue.name }).check();
    await dialog.getByLabel('Search venues to assign').fill('');
    await expect(dialog.getByText('1 venue chosen.')).toBeVisible();
    await dialog.getByLabel('Search venues to assign').press('Enter'); // must not submit the invite form
    await expect(dialog.getByText(/Enter the name|Choose at least one venue/)).toHaveCount(0);

    // Submitting an empty form shows what is missing; Cancel and Escape close it.
    await dialog.getByRole('button', { name: 'Invite Owner' }).click();
    await expect(dialog.getByText('Enter the name.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '+ Add owner' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add owner' })).toHaveCount(0);
  });

  test('adding an owner from the dialog creates the login and lands on the Logins tab', async ({ page, adminApi }) => {
    const tag = Math.random().toString(36).slice(2, 8);
    const org = await adminApi.post('/admin/organizations', {
      data: { name: `PW Modal Org ${tag}`, contactEmail: `pw-modal-org-${tag}@example.com`, contactPhone: '+919999900000' },
    });
    expect(org.ok(), await org.text()).toBeTruthy();
    const orgId = (await org.json()).id as string;
    await page.goto(`/owners/${orgId}`);
    await page.getByRole('button', { name: '+ Add owner' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add owner' });
    await dialog.getByLabel('Name').fill(`PW Modal Owner ${tag}`);
    await dialog.getByLabel('Email').fill(`pw-modal-${tag}@example.com`);
    await dialog.getByRole('button', { name: 'Invite Owner' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`Invited pw-modal-${tag}@example.com`)).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Logins/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText(`PW Modal Owner ${tag}`)).toBeVisible();
  });

  test('announcements: the owners to choose from are searched and paged', async ({ page }) => {
    await page.goto('/announcements');
    await page.getByRole('radio', { name: 'Selected Owners' }).check();
    const search = page.getByLabel('Search owners');
    await expect(search).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('navigation', { name: 'Pagination' })).toBeVisible();
    const first = (await page.locator('#announce-owners label').first().innerText()).split('(')[0]!.trim();
    await search.fill(first);
    await expect(page.locator('#announce-owners label').first()).toContainText(first);
    await search.fill('zzz-nobody-zzz');
    await expect(page.getByText('No owners match your search.')).toBeVisible();
  });

  test('a venue with many units pages them ten at a time', async ({ page, adminApi, ownerApi, makeVenue }) => {
    test.setTimeout(120_000);
    const venue = await makeVenue();
    const categories = (await (await ownerApi.get('/categories')).json()) as Array<{ id: string; name: string }>;
    const football = categories.find((c) => c.name === 'Football Turf')!;
    for (let i = 0; i < 12; i++) {
      const res = await ownerApi.post('/resources', { data: { venueId: venue.id, categoryId: football.id, name: `PW Extra ${i}`, groundType: '5S' } });
      expect(res.ok(), await res.text()).toBeTruthy();
    }
    void adminApi;
    await page.goto(`/venues/${venue.id}`);
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText('1–10 of 13'); // the turf it came with and the twelve added
    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText('11–13 of 13');
  });
});
