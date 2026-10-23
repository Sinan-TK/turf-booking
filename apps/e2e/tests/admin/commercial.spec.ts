import { unique } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/**
 * Commercial terms in the Super Admin portal: edited on the facility's page (a facility created for the test,
 * so no real facility is touched), a venue's own deal on the venue's page, and the weekly payouts.
 */
test.describe('admin: commercial terms', () => {
  test('a facility\'s commission, advance and cancellation windows are edited on its page and persist', async ({ page, adminApi }) => {
    const slug = `PW_${unique().toUpperCase()}`;
    const created = await adminApi.post('/admin/categories', {
      data: {
        slug,
        name: `PW Facility ${slug}`,
        defaultAllocationMode: 'EXCLUSIVE',
        iconKey: 'category',
        unitLabel: 'Unit',
        venueLabel: 'Venue',
        unitTypes: [],
        policy: { slotIntervalMin: 60, minDurationMin: 60, maxDurationMin: 180, durationIncrementMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, maxAdvanceDays: 30, minLeadMinutes: 0 },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/venue-types/${id}`);
    await expect(page.getByRole('heading', { name: 'Commission & cancellation', level: 2 })).toBeVisible();

    // A new facility starts from the platform default; change several values.
    await page.getByLabel('Minimum advance').fill('40');
    await page.getByLabel('Monthly commission cap').fill('1500');
    await page.getByLabel('Cancellation cut-off in minutes').fill('90');
    await page.getByRole('button', { name: 'Add a tier' }).click();
    await page.getByLabel('Tier 2 starts at booking').fill('30');
    await page.getByLabel('Tier 2 value').fill('8');
    await page.getByLabel('Window 1 hours').fill('12');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();

    // The values survive a reload.
    await page.reload();
    await expect(page.getByLabel('Minimum advance')).toHaveValue('40');
    await expect(page.getByLabel('Monthly commission cap')).toHaveValue('1500');
    await expect(page.getByLabel('Cancellation cut-off in minutes')).toHaveValue('90');
    await expect(page.getByLabel('Tier 2 starts at booking')).toHaveValue('30');
    await expect(page.getByLabel('Tier 2 value')).toHaveValue('8');
    await expect(page.getByLabel('Window 1 hours')).toHaveValue('12');

    // Clearing the cap means "no cap".
    await page.getByLabel('Monthly commission cap').fill('');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    const terms = await (await adminApi.get(`/admin/categories/${id}/commercial-terms`)).json();
    expect(terms.terms.monthlyCommissionCap).toBeNull();
    expect(terms.terms.minAdvancePercent).toBe(40);
    expect(terms.terms.commissionTiers).toHaveLength(2);
  });

  test('a venue can have its own deal for one facility; everything else keeps following the facility', async ({ page, venue, adminApi }) => {
    await page.goto(`/venues/${venue.id}`);
    const section = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Commission & cancellation', level: 2 }) }).last();
    await expect(page.getByRole('heading', { name: 'Commission & cancellation', level: 2 })).toBeVisible();
    await expect(section.getByText(/minimum advance/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Set a custom deal' }).first().click();
    // Nothing is overridden yet: the groups describe what they follow.
    await expect(page.getByText(/\(from (the facility|the platform default)\)/).first()).toBeVisible();
    await page.getByLabel('Custom for this venue').nth(1).check(); // the monthly cap group
    await page.getByLabel('Monthly commission cap').fill('1234');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await expect(page.getByText(/capped at ₹1234\/month/)).toBeVisible();

    const rows = (await (await adminApi.get(`/admin/venues/${venue.id}/commercial-terms`)).json()) as Array<{
      name: string;
      own: Record<string, unknown> | null;
    }>;
    const football = rows.find((r) => r.name === 'Football Turf')!;
    expect(football.own).toEqual({ monthlyCommissionCap: 1234 });

    await page.getByRole('button', { name: "Remove this venue's deal" }).click();
    await expect(page.getByText(/capped at ₹1234\/month/)).toHaveCount(0);
    const after = (await (await adminApi.get(`/admin/venues/${venue.id}/commercial-terms`)).json()) as typeof rows;
    expect(after.find((r) => r.name === 'Football Turf')!.own).toBeNull();
  });

  test('the platform default holds the payout day', async ({ page }) => {
    await page.goto('/policies');
    await expect(page.getByRole('heading', { name: 'Owner payouts', level: 3 })).toBeVisible();
    await expect(page.getByLabel('Payout day')).toBeVisible();
    await expect(page.getByLabel('Payout timezone')).toHaveValue(/\w+\/\w+/);
  });
});

test.describe('admin: payouts', () => {
  test('the payouts page shows the money totals and can prepare payouts on demand', async ({ page }) => {
    await page.goto('/payouts');
    await expect(page.getByRole('heading', { name: 'Owner payouts', level: 1 })).toBeVisible();
    await expect(page.getByText('Coins customers hold')).toBeVisible();
    await expect(page.getByText('Platform earnings this month')).toBeVisible();
    await page.getByRole('button', { name: 'Prepare payouts now' }).click();
    await expect(page.getByText(/Completed \d+ booking\(s\), settled \d+, \d+ payout\(s\) prepared\./)).toBeVisible();
  });

  test('the dashboard and sidebar reach payouts', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Money', level: 2 })).toBeVisible();
    await expect(page.getByText('Owner payouts to pay')).toBeVisible();
    await page.getByRole('navigation').getByRole('link', { name: 'Payouts' }).click();
    await expect(page).toHaveURL(/\/payouts$/);
  });

  test('a payout is reviewed and marked paid with a bank reference (when one is waiting)', async ({ page }) => {
    await page.goto('/payouts');
    await page.getByRole('button', { name: 'Prepare payouts now' }).click();
    await expect(page.getByText(/payout\(s\) prepared\./)).toBeVisible();
    const review = page.getByRole('link', { name: /Review & pay/ }).first();
    test.skip((await review.count()) === 0, 'no payout is waiting in this database');
    await review.click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('₹');
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(page.getByText('Enter the bank transfer reference (UTR).')).toBeVisible();
    await page.getByLabel('Bank transfer reference (UTR)').fill(`UTR${unique().toUpperCase()}`);
    await page.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(page.getByText(/reference/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as paid' })).toHaveCount(0);
  });
});
