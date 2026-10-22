import { istInstant, nextIstDay, uniquePhone } from '../../support/dates';
import { unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { field } from '../../support/ui';

test.describe('admin: venue details', () => {
  test('the Super Admin can set every venue status, including Draft and Suspended', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: venue.name, level: 1 })).toBeVisible();
    for (const status of ['DRAFT', 'SUSPENDED', 'INACTIVE', 'ACTIVE']) {
      await page.getByRole('button', { name: status, exact: true }).click();
      await expect(page.getByRole('button', { name: status, exact: true })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  test('units can be blocked and reopened, and a unit can be added', async ({ page, makeVenue }) => {
    const venue = await makeVenue();
    await page.goto(`/venues/${venue.id}`);
    await expect(page.getByRole('heading', { name: 'Football Turf', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Badminton Court', level: 3 })).toBeVisible();

    await page.getByRole('switch', { name: `Block ${venue.turfName}` }).click();
    await expect(page.getByRole('switch', { name: `Reopen ${venue.turfName}` })).not.toBeChecked();
    await page.getByRole('switch', { name: `Reopen ${venue.turfName}` }).click();
    await expect(page.getByRole('switch', { name: `Block ${venue.turfName}` })).toBeChecked();

    // A facility with no preset types asks for no type.
    await field(page, /^Facility$/).selectOption({ label: 'Badminton Court' });
    await expect(page.locator('label').filter({ hasText: /type/i })).toHaveCount(0);
    await field(page, /name/).fill('Court 2');
    await page.getByRole('button', { name: 'Add unit' }).click();
    await expect(page.getByText('Court 2', { exact: true })).toBeVisible();
  });

  test('the venue is found by name and by facility in the list', async ({ page, venue }) => {
    await page.goto('/venues');
    await page.getByLabel('Search venues').fill(venue.name);
    const row = page.getByRole('row').filter({ hasText: venue.name });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Football Turf');
    await expect(row).toContainText('Badminton Court');
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/venues/${venue.id}$`));
  });
});

test.describe('admin: customers', () => {
  test('a customer opens with their details, and can be blocked and unblocked with a confirmation', async ({ page, venue, ownerApi }) => {
    // A walk-in creates a real customer for this test to act on, so no existing customer is touched.
    const phone = uniquePhone();
    const name = `PW Customer ${unique()}`;
    const res = await ownerApi.post('/owner/bookings', {
      data: {
        resourceId: venue.courtId,
        durationMinutes: 60,
        customerWhatsappNumber: phone,
        customerName: name,
        startTime: istInstant(nextIstDay(2), 10),
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    await page.goto('/customers');
    await page.getByLabel('Search customers').fill(phone);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1);
    await row.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent bookings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Coin wallet' })).toBeVisible();

    // Block: asks first (Cancel keeps them active), then Block.
    await page.getByRole('button', { name: 'Block customer' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Block customer' })).toBeVisible();
    await page.getByRole('button', { name: 'Block customer' }).click();
    await page.getByPlaceholder(/Reason/).fill('Playwright test');
    await page.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(page.getByText('BLOCKED').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unblock customer' })).toBeVisible();

    await page.getByRole('button', { name: 'Unblock customer' }).click();
    await page.getByRole('button', { name: /^Unblock$/ }).click();
    await expect(page.getByRole('button', { name: 'Block customer' })).toBeVisible();
  });

  test('the wallet adjustment is a Credit/Debit switch with a live preview', async ({ page, venue, ownerApi }) => {
    const phone = uniquePhone();
    const name = `PW Wallet ${unique()}`;
    const res = await ownerApi.post('/owner/bookings', {
      data: { resourceId: venue.courtId, durationMinutes: 60, customerWhatsappNumber: phone, customerName: name, startTime: istInstant(nextIstDay(2), 12) },
    });
    expect(res.ok(), await res.text()).toBeTruthy();

    await page.goto('/customers');
    await page.getByLabel('Search customers').fill(phone);
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toHaveCount(1); // wait for the list to settle before clicking in it
    await row.getByRole('link').first().click();
    await expect(page.getByRole('heading', { name: 'Coin wallet' })).toBeVisible();

    const credit = page.getByRole('button', { name: 'Credit', exact: true });
    const debit = page.getByRole('button', { name: 'Debit', exact: true });
    await expect(credit).toHaveAttribute('aria-pressed', 'true');
    await page.getByPlaceholder('0').fill('50');
    await expect(page.getByText(/New balance/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Credit .*50.* coins/ })).toBeVisible();

    await debit.click();
    await expect(debit).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/That is more than the wallet holds/)).toBeVisible(); // a new customer has no coins to debit

    await credit.click();
    // No reason yet: the form refuses and says so under the field.
    await page.getByRole('button', { name: /Credit .*50.* coins/ }).click();
    await expect(page.getByText('Enter the reason.')).toBeVisible();
    await page.getByPlaceholder(/Goodwill credit/).fill('Playwright test credit');
    await expect(page.getByText('Enter the reason.')).toHaveCount(0);
    await page.getByRole('button', { name: /Credit .*50.* coins/ }).click();
    await expect(page.getByText(/50/).first()).toBeVisible();
  });
});

test.describe('admin: facilities', () => {
  test('the facility list opens a facility and the new-facility form validates its name', async ({ page }) => {
    await page.goto('/venue-types');
    await expect(page.getByRole('heading', { name: 'Facilities', level: 1 })).toBeVisible();
    await page.getByLabel('Search facilities').fill('Football');
    await page.getByRole('row').filter({ hasText: 'Football Turf' }).first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/venue-types\/[0-9a-f-]{36}$/);

    await page.goto('/venue-types');
    await page.getByRole('link', { name: /New facility/ }).click();
    await expect(page).toHaveURL(/\/venue-types\/new$/);
    await expect(page.getByRole('heading', { name: 'New facility', level: 1 })).toBeVisible();
    // Saving an empty form says what is missing, field by field, and the message clears as it is fixed.
    await page.getByRole('button', { name: 'Create facility' }).click();
    await expect(page.getByText('Enter the name.')).toBeVisible();
    await expect(page.getByText('Enter an identifier, like CHESS.')).toBeVisible();
    // The identifier follows the name.
    await field(page, 'Name').fill('PW Squash');
    await expect(page.getByText('Enter the name.')).toHaveCount(0);
    await expect(page.getByText('Enter an identifier, like CHESS.')).toHaveCount(0);
    await expect(field(page, 'Identifier')).toHaveValue('PW_SQUASH');
  });
});
