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
    await expect(page.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Minimum advance')).toHaveCount(0); // the terms are on their own tabs

    // Commission tab: only the commission cards.
    await page.getByRole('tab', { name: 'Commission' }).click();
    await expect(page).toHaveURL(/[?&]tab=commission/);
    await expect(page.getByRole('heading', { name: 'Commission', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Cancellation cut-off in minutes')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save terms' })).toHaveCount(0); // nothing changed yet
    await page.getByLabel('Minimum advance').fill('40');
    await expect(page.getByRole('button', { name: 'Save terms' })).toBeVisible();
    await page.getByLabel('Monthly commission cap').fill('1500');
    await page.getByRole('button', { name: 'Add a tier' }).click();
    await page.getByLabel('Tier 2 starts at booking').fill('30');
    await page.getByLabel('Tier 2 value').fill('8');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved./)).toBeVisible();

    // Cancellation tab: only the cancellation cards, and saving it leaves the commission values alone.
    await page.getByRole('tab', { name: 'Cancellation' }).click();
    await expect(page.getByRole('heading', { name: 'Cancellation', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Monthly commission cap')).toHaveCount(0);
    await page.getByLabel('Cancellation cut-off in minutes').fill('90');
    await page.getByLabel('Window 1 hours').fill('12');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved./)).toBeVisible();

    // The values survive a reload of each tab (the address keeps the tab).
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Cancellation' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Cancellation cut-off in minutes')).toHaveValue('90');
    await expect(page.getByLabel('Window 1 hours')).toHaveValue('12');
    await page.getByRole('tab', { name: 'Commission' }).click();
    await expect(page.getByLabel('Minimum advance')).toHaveValue('40');
    await expect(page.getByLabel('Monthly commission cap')).toHaveValue('1500');
    await expect(page.getByLabel('Tier 2 starts at booking')).toHaveValue('30');
    await expect(page.getByLabel('Tier 2 value')).toHaveValue('8');

    // Clearing the cap means "no cap".
    await page.getByLabel('Monthly commission cap').fill('');
    await page.getByRole('button', { name: 'Save terms' }).click();
    await expect(page.getByText(/^Saved./)).toBeVisible();
    const terms = await (await adminApi.get(`/admin/categories/${id}/commercial-terms`)).json();
    expect(terms.terms.monthlyCommissionCap).toBeNull();
    expect(terms.terms.minAdvancePercent).toBe(40);
    expect(terms.terms.commissionTiers).toHaveLength(2);
    expect(terms.terms.cancelCutoffMinutes).toBe(90);
  });

  test('a facility display order is its own: a number another facility has is refused in the header', async ({ page, adminApi }) => {
    const make = async (extra: Record<string, unknown> = {}) => {
      const slug = `PW_${unique().toUpperCase()}`;
      const res = await adminApi.post('/admin/categories', {
        data: { slug, name: `PW Order ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [], ...extra },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()) as { id: string; sortOrder: number; name: string };
    };
    const a = await make();
    const b = await make();
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder); // a new facility takes the next free number

    await page.goto(`/venue-types/${b.id}`);
    const header = page.locator('section').filter({ has: page.getByRole('heading', { level: 1 }) }).first();
    // The Info form no longer has these two: they live in the header section, on the right.
    await expect(page.getByRole('heading', { name: 'Visibility' })).toHaveCount(0);

    await header.getByLabel('Display order').fill(String(a.sortOrder));
    await header.getByRole('button', { name: 'Save' }).click();
    // The header says who has the number and offers to switch places with it.
    await expect(header.getByText(new RegExp(`already has number ${a.sortOrder}`))).toBeVisible();
    const bBefore = b.sortOrder;
    await header.getByRole('button', { name: /Switch places with PW Order/ }).click();
    await expect
      .poll(async () => ((await (await adminApi.get(`/admin/categories/${b.id}`)).json()) as { sortOrder: number }).sortOrder)
      .toBe(a.sortOrder);
    const aNow = (await (await adminApi.get(`/admin/categories/${a.id}`)).json()) as { sortOrder: number };
    expect(aNow.sortOrder).toBe(bBefore); // they traded numbers

    const free = 70_000 + Math.floor(Math.random() * 9_000);
    await header.getByLabel('Display order').fill(String(free));
    await header.getByRole('button', { name: 'Save' }).click();
    await expect
      .poll(async () => ((await (await adminApi.get(`/admin/categories/${b.id}`)).json()) as { sortOrder: number }).sortOrder)
      .toBe(free);
    await expect(header.getByRole('button', { name: 'Save' })).toBeDisabled(); // saved: nothing left to save
  });

  test('a facility is switched active or inactive from the header, and saving the Info tab does not undo it', async ({ page, adminApi }) => {
    const slug = `PW_${unique().toUpperCase()}`;
    const res = await adminApi.post('/admin/categories', {
      data: { slug, name: `PW Status ${slug}`, defaultAllocationMode: 'EXCLUSIVE', iconKey: 'category', unitLabel: 'Unit', venueLabel: 'Venue', unitTypes: [] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const { id } = (await res.json()) as { id: string };
    const isActive = async () => ((await (await adminApi.get(`/admin/categories/${id}`)).json()) as { isActive: boolean }).isActive;

    await page.goto(`/venue-types/${id}`);
    const status = page.getByRole('switch', { name: 'Active' });
    await expect(status).toHaveAttribute('aria-checked', 'true');
    await status.click();
    await expect(status).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
    expect(await isActive()).toBe(false);

    // Saving the Info form (opened before the change was made, so it holds the old value) leaves the status alone.
    // The save bar is not there until something in the form changes.
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await page.getByLabel('One bookable unit is a…').fill('Board');
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Facility saved.')).toBeVisible();
    expect(await isActive()).toBe(false);
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0); // saved: the bar goes away again

    await status.click();
    await expect(status).toHaveAttribute('aria-checked', 'true');
    expect(await isActive()).toBe(true);
  });

  test('a venue can have its own deal for one facility; everything else keeps following the facility', async ({ page, venue, adminApi }) => {
    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('tab', { name: 'Commercial terms' }).click();
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

  test('a facility cancellation tab has the on/off switch and an editable platform share; the platform default has no cancellation', async ({ page, adminApi }) => {
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

    await page.goto('/policies');
    await expect(page.getByRole('heading', { name: 'Commission', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cancellation windows', level: 3 })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Allow customers to cancel' })).toHaveCount(0);

    await page.goto(`/venue-types/${id}`);
    await page.getByRole('tab', { name: 'Cancellation' }).click();
    const sw = page.getByRole('switch', { name: 'Allow customers to cancel' });
    await expect(sw).toBeChecked();
    await sw.uncheck();
    await expect(page.getByText('Off: no cancellation is available')).toBeVisible();
    await sw.check();
    await expect(page.getByText('On: the cancellation windows apply')).toBeVisible();

    await page.getByLabel('Window 1 customer share').fill('50');
    await page.getByLabel('Window 1 owner share').fill('30');
    await expect(page.getByLabel('Window 1 platform share')).toHaveValue('20');
    await expect(page.getByText('Customer 50% · Owner 30% · Platform 20%')).toBeVisible();
    // Raising the platform's share takes it out of the owner's.
    await page.getByLabel('Window 1 platform share').fill('35');
    await expect(page.getByLabel('Window 1 owner share')).toHaveValue('15');
    await expect(page.getByText('Customer 50% · Owner 15% · Platform 35%')).toBeVisible();
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
