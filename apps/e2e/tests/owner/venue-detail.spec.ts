import { expect, test } from '../../support/fixtures';
import { field } from '../../support/ui';

test.describe('owner portal: venue details', () => {
  test('shows the header, stats, and each facility with its units', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: venue.name, level: 1 })).toBeVisible();
    await expect(page.getByText('ACTIVE').first()).toBeVisible();
    await expect(page.getByText(venue.facilityCode).first()).toBeVisible();

    // Stat tiles: 2 facilities, 2 units, both open, none blocked.
    await expect(page.getByText('Facilities', { exact: true }).first().locator('xpath=..')).toContainText('2');
    await expect(page.getByText('Open for booking').locator('xpath=..')).toContainText('2');
    await expect(page.getByText('Blocked', { exact: true }).first().locator('xpath=..')).toContainText('0');

    // One card per facility, the unit under it with its type (the court has none).
    await expect(page.getByRole('heading', { name: 'Football', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Badminton Court', level: 2 })).toBeVisible();
    await expect(page.getByText('Turf type · 5S')).toBeVisible();
    await expect(page.getByText(venue.courtName, { exact: true })).toBeVisible();
  });

  test('the back button before the name goes to the venues list; pricing and availability are on the same page', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('link', { name: 'Back to all venues' }).click();
    await expect(page).toHaveURL(/\/venues$/);

    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: 'Pricing & availability', level: 2 })).toBeVisible();
    for (const tab of ['Pricing & hours', 'Closed days', 'Walk-in booking']) await expect(page.getByRole('tab', { name: tab })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}$`));
  });

  test('the old pricing address lands on the venue page, at its pricing section', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}/availability`);
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}#pricing$`));
    await expect(page.getByRole('heading', { name: 'Pricing & availability', level: 2 })).toBeVisible();
  });

  test('the Google Maps link and the advance booking days are rows of the details with an Edit button each', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('button', { name: 'Edit Google Maps link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit advance booking' })).toBeVisible();
  });

  test('blocking a unit asks first: cancel changes nothing, confirm blocks, then it can be reopened', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
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
    await expect(page.getByText('Blocked', { exact: true }).first().locator('xpath=..')).toContainText('1');

    await reopen.click();
    await expect(dialog.getByRole('heading', { name: `Reopen ${venue.turfName}?` })).toBeVisible();
    await dialog.getByRole('button', { name: 'Reopen for booking' }).click();
    await expect(page.getByRole('switch', { name: `Block ${venue.turfName}` })).toBeChecked();
  });

  test('a whole facility can be blocked and reopened without touching the others', async ({ page, venue }) => {
    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('button', { name: 'Block Badminton Court' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: 'Block all of Badminton Court?' })).toBeVisible();
    await expect(dialog).toContainText('Your other facilities at this venue are not affected');
    await dialog.getByRole('button', { name: /^Block/ }).click();

    await expect(page.getByRole('switch', { name: `Reopen ${venue.courtName}` })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: `Block ${venue.turfName}` })).toBeChecked(); // the turf is untouched

    await page.getByRole('button', { name: 'Reopen Badminton Court' }).click();
    await dialog.getByRole('button', { name: 'Reopen all' }).click();
    await expect(page.getByRole('switch', { name: `Block ${venue.courtName}` })).toBeChecked();
  });

  test('adding a unit: no type for a typeless facility, a required type where types are preset', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
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
    await expect(page.getByText('Court 2', { exact: true })).toBeVisible();

    // Football has 5S / 7S, and one must be chosen.
    await field(unitForm, 'Facility').selectOption({ label: 'Football' });
    await field(unitForm, /name/).fill('Turf B');
    await add.click();
    await expect(page.getByText(/Select the (turf|pitch) type./i)).toBeVisible();
    await field(unitForm, /type/).selectOption('7S');
    await expect(page.getByText(/Select the (turf|pitch) type./i)).toHaveCount(0);
    await add.click();
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
