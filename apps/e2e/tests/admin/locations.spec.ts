import { URLS, unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** The Super Admin builds the location tree: states with codes, districts with codes, areas with a centre; and can switch each off. */
test.describe('admin: locations', () => {
  test('a new state, district and area can be added, edited and switched off, and the area shows up for customers', async ({ page, request }) => {
    const tag = unique().replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
    await page.goto('/locations');
    await expect(page.getByRole('heading', { name: 'Locations', level: 1 })).toBeVisible();

    // State: both name and code are needed.
    const addState = page.getByRole('form', { name: 'Add a state' });
    await addState.getByRole('button', { name: 'Add state' }).click();
    await expect(addState.getByText('Enter the state name.')).toBeVisible();
    await expect(addState.getByText('Enter the state code, like KL.')).toBeVisible();
    await addState.getByLabel('State name').fill(`PW State ${tag}`);
    await addState.getByLabel(/State code/).fill(`p${tag}`);
    await addState.getByRole('button', { name: 'Add state' }).click();
    await expect(page.getByRole('heading', { name: `Districts in PW State ${tag}` })).toBeVisible(); // the new state is opened

    // The same name is refused with a clear message.
    await addState.getByLabel('State name').fill(`PW State ${tag}`);
    await addState.getByLabel(/State code/).fill(`Q${tag}`);
    await addState.getByRole('button', { name: 'Add state' }).click();
    await expect(page.getByText(/state with that name already exists/i)).toBeVisible();

    // District.
    const addDistrict = page.getByRole('form', { name: 'Add a district' });
    await addDistrict.getByLabel('District name').fill(`PW District ${tag}`);
    await addDistrict.getByLabel(/District code/).fill(`d${tag}`);
    await addDistrict.getByRole('button', { name: 'Add district' }).click();
    await expect(page.getByRole('heading', { name: `Areas in PW District ${tag}` })).toBeVisible();

    // Area: a centre needs both numbers.
    const addArea = page.getByRole('form', { name: 'Add an area' });
    await addArea.getByLabel('Area name').fill(`PW Area ${tag}`);
    await addArea.getByLabel(/Latitude/).fill('13.08');
    await addArea.getByRole('button', { name: 'Add area' }).click();
    await expect(addArea.getByText('Enter the longitude.')).toBeVisible();
    await addArea.getByLabel(/Longitude/).fill('80.27');
    await addArea.getByRole('button', { name: 'Add area' }).click();
    const row = page.getByRole('row', { name: new RegExp(`PW Area ${tag}`) });
    await expect(row).toContainText('13.08, 80.27');

    // Customers can see it as "Area, District, State".
    const places = async () => ((await (await request.get(`${URLS.api}/places`)).json()) as Array<{ name: string; districtName: string; stateName: string }>);
    expect((await places()).find((p) => p.name === `PW Area ${tag}`)).toMatchObject({ districtName: `PW District ${tag}`, stateName: `PW State ${tag}` });

    // Edit the area's name, then switch it off: customers stop seeing it, the admin still lists it.
    await row.getByRole('button', { name: /Edit area/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(`PW Area ${tag} B`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    const renamed = page.getByRole('row', { name: new RegExp(`PW Area ${tag} B`) });
    await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: /Deactivate area/ }).click();
    await expect(renamed).toContainText('INACTIVE');
    await expect.poll(async () => (await places()).some((p) => p.name.startsWith(`PW Area ${tag}`))).toBe(false);
    await renamed.getByRole('button', { name: /^Activate area/ }).click();
    await expect.poll(async () => (await places()).some((p) => p.name === `PW Area ${tag} B`)).toBe(true);
  });
});
