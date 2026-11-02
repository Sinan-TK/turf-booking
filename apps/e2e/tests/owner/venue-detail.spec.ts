import { expect, test } from '../../support/fixtures';
import { field, openSection, openUnitTab } from '../../support/ui';

test.describe('owner portal: venue details', () => {
  test('shows the header, stats, and each facility with its units', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: venue.name, level: 1 })).toBeVisible();
    await expect(page.getByText('ACTIVE').first()).toBeVisible();
    await expect(page.getByText(venue.facilityCode).first()).toBeVisible();

    // Stat tiles: 2 facilities, 2 units, both open, none blocked.
    await expect(page.getByText('Facilities', { exact: true }).last().locator('xpath=..')).toContainText('2'); // the stat tile (the venue's details above it also have a Facilities row)
    await expect(page.getByText('Open for booking').locator('xpath=..')).toContainText('2');
    await expect(page.getByText('Blocked', { exact: true }).first().locator('xpath=..')).toContainText('0');

    // The venue's own tab is open first; the Units tab has one tab per unit (the first is open), then New; each unit's tab shows its facility and its type (the court has none).
    await openSection(page, 'Units');
    const tabs = page.getByRole('tablist', { name: 'Units' }).getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Football', level: 2 })).toBeVisible();
    await expect(page.getByText('Turf type · 5S')).toBeVisible();
    await openUnitTab(page, venue.courtName);
    await expect(page.getByRole('heading', { name: 'Badminton Court', level: 2 })).toBeVisible();
    await expect(page.getByText(venue.courtName, { exact: true }).first()).toBeVisible();
  });

  test('the back button before the name goes to the venues list; pricing and availability are on the same page', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('link', { name: 'Back to all venues' }).click();
    await expect(page).toHaveURL(/\/venues$/);

    await page.goto(`/venues/${venue.id}`);
    // The open unit's tab has its prices and closed days right there (walk-in bookings have their own page).
    await openSection(page, 'Units');
    for (const tab of ['Pricing & hours', 'Closed days']) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Walk-in booking' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pricing' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}$`));
  });

  test('the old pricing address lands on the venue page, where the first unit shows its prices', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}/availability`);
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}#pricing$`));
    await expect(page.getByRole('tab', { name: 'Pricing & hours' })).toHaveAttribute('aria-selected', 'true');
  });

  test('the venue description is edited from its Edit button at the top, and shows there', async ({ page, makeVenue, ownerApi }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByLabel('About this venue').fill('Floodlit turf with parking and a canteen.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByLabel('About this venue')).toHaveCount(0); // saved: the editor closes
    await expect(page.getByText('Floodlit turf with parking and a canteen.')).toBeVisible();
    expect((await (await ownerApi.get(`/venues/${venue.id}`)).json()).description).toBe('Floodlit turf with parking and a canteen.');
    await page.reload();
    await expect(page.getByText('Floodlit turf with parking and a canteen.')).toBeVisible();
  });

  test('the Google Maps link and the advance booking days are rows of the details with an Edit button each', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('button', { name: 'Edit Google Maps link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit advance booking' })).toBeVisible();
  });

  test('blocking a unit asks first: cancel changes nothing, confirm blocks, then it can be reopened', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await openSection(page, 'Units');
    const toggle = page.getByRole('switch', { name: `Block ${venue.turfName}` });
    await expect(toggle).toBeChecked();

    await toggle.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: `Block ${venue.turfName}?` })).toBeVisible();
    await expect(dialog).toContainText('Bookings that are already made are not cancelled');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused(); // Enter cannot confirm by accident
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeChecked();

    // Escape also closes it without changing anything.
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(toggle).toBeChecked();

    await toggle.click();
    await dialog.getByRole('button', { name: 'Block bookings' }).click();
    await expect(dialog).toHaveCount(0);
    const reopen = page.getByRole('switch', { name: `Reopen ${venue.turfName}` });
    await expect(reopen).not.toBeChecked();
    await openSection(page, 'Venue'); // the count tiles are on the Venue tab
    await expect(page.getByText('Blocked', { exact: true }).first().locator('xpath=..')).toContainText('1');
    await openSection(page, 'Units');

    await reopen.click();
    await expect(dialog.getByRole('heading', { name: `Reopen ${venue.turfName}?` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reopen for booking' }).click();
    await expect(page.getByRole('switch', { name: `Block ${venue.turfName}` })).toBeChecked();
  });

  test('a whole facility can be blocked and reopened without touching the others', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, venue.courtName);
    await page.getByRole('button', { name: 'Block Badminton Court' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Block all of Badminton Court?' })).toBeVisible();
    await expect(dialog).toContainText('Your other facilities at this venue are not affected');
    await dialog.getByRole('button', { name: /^Block/ }).click();

    await expect(page.getByRole('switch', { name: `Reopen ${venue.courtName}` })).not.toBeChecked();
    await openUnitTab(page, venue.turfName);
    await expect(page.getByRole('switch', { name: `Block ${venue.turfName}` })).toBeChecked(); // the turf is untouched

    await openUnitTab(page, venue.courtName);
    await page.getByRole('button', { name: 'Reopen Badminton Court' }).click();
    await dialog.getByRole('button', { name: 'Reopen all' }).click();
    await expect(page.getByRole('switch', { name: `Block ${venue.courtName}` })).toBeChecked();
  });

  test('adding a unit: no type for a typeless facility, a required type where types are preset', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await openUnitTab(page, 'New');
    const unitForm = page.getByRole('heading', { name: 'Add a unit' }).locator('xpath=ancestor::section[1]');
    const add = page.getByRole('button', { name: /^Add (court|turf|pitch|unit)$/ });
    await expect(add).toBeEnabled();
    await add.click(); // nothing chosen yet: the form says what is missing, field by field
    await expect(page.getByText('Select a facility.')).toBeVisible();

    // Badminton has no preset types, so the form does not ask for one at all.
    await field(unitForm, 'Facility').selectOption({ label: 'Badminton Court' });
    await expect(page.locator('label').filter({ hasText: /type/i })).toHaveCount(0);
    await expect(page.getByText('Select a facility.')).toHaveCount(0);
    await add.click();
    await expect(page.getByText(/Enter the court name./i)).toBeVisible();
    await field(unitForm, /name/).fill('Court 2');
    await expect(add).toBeEnabled();
    await add.click();
    // The new unit gets its own tab, and it opens.
    await expect(page.getByRole('tab', { name: /^Court 2/ })).toHaveAttribute('aria-selected', 'true');

    // Football has 5S / 7S, and one must be chosen.
    await openUnitTab(page, 'New');
    await field(unitForm, 'Facility').selectOption({ label: 'Football' });
    await field(unitForm, /name/).fill('Turf B');
    await add.click();
    await expect(page.getByText(/Select the (turf|pitch) type./i)).toBeVisible();
    await field(unitForm, /type/).selectOption('7S');
    await expect(page.getByText(/Select the (turf|pitch) type./i)).toHaveCount(0);
    await add.click();
    await expect(page.getByRole('tab', { name: /^Turf B/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Turf type · 7S')).toBeVisible();
  });

  test('an owner can pause the venue but not set it back to draft or live', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    // Only Active and Inactive are shown; Draft and Suspended belong to the platform.
    await expect(page.getByRole('button', { name: 'ACTIVE', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'DRAFT' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'SUSPENDED' })).toHaveCount(0);

    await page.getByRole('button', { name: 'INACTIVE', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: `Pause ${venue.name}?` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Pause venue' }).click();
    await expect(page.getByRole('button', { name: 'INACTIVE', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'ACTIVE', exact: true })).toBeDisabled(); // only the platform can reopen it
  });
});
