import type { APIRequestContext, Page } from '@playwright/test';
import { istInstant, istToday, uniquePhone } from '../../support/dates';
import { URLS } from '../../support/env';
import { expect, test } from '../../support/fixtures';
import { createStaff } from '../../support/staff';

async function walkIn(owner: APIRequestContext, resourceId: string, hour: number, name: string) {
  const res = await owner.post('/owner/bookings', {
    data: {
      resourceId,
      durationMinutes: 60,
      customerWhatsappNumber: uniquePhone(),
      customerName: name,
      amount: 500, // explicit: a start earlier today can precede the new venue's price taking effect
      startTime: istInstant(istToday(), hour),
    },
  });
  expect(res.ok(), `walk-in failed: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string; orderId: string };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('owner portal: staff page (owner admin)', () => {
  test('invites staff to chosen venues, changes their venues, and disables them', async ({ page, venue, makeVenue }) => {
    const second = await makeVenue();
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();

    await page.getByRole('button', { name: 'Invite staff' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('Enter the name.')).toBeVisible();
    await expect(dialog.getByText('Enter your email address.')).toBeVisible();
    await expect(dialog.getByText('Choose at least one venue.')).toBeVisible();

    const name = `PW Invitee ${Date.now()}`;
    const email = `pw-invitee-${Date.now()}@example.com`;
    await dialog.locator('#staff-name').fill(name);
    await dialog.locator('#staff-email').fill(email);
    await dialog.getByRole('checkbox', { name: venue.name }).check();
    await expect(dialog.getByText('Choose at least one venue.')).toHaveCount(0);
    // The phone is optional, but when given it must be an Indian mobile number (the +91 is shown outside the box).
    await dialog.locator('#staff-phone').fill('12345');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('Enter the full 10-digit mobile number.')).toBeVisible();
    await dialog.locator('#staff-phone').fill('5876543210');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('Indian mobile numbers start with 6, 7, 8 or 9.')).toBeVisible();
    await dialog.locator('#staff-phone').fill('');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: email });
    await expect(row).toContainText(venue.name);
    await expect(row).not.toContainText(second.name);

    await row.getByRole('button', { name: 'Edit venues' }).click();
    await page.getByRole('checkbox', { name: second.name }).check();
    await page.getByRole('dialog').getByRole('button', { name: 'Save venues' }).click();
    await expect(row).toContainText(second.name);

    await row.getByRole('button', { name: 'Disable' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click();
    await expect(row.getByRole('button', { name: 'Enable' })).toBeVisible();
  });
});

test.describe('owner portal: venue-based staff', () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: URLS.owner, timezoneId: 'Asia/Kolkata' });

  test('chooses a venue after signing in, sees only that venue and only the pages staff may open', async ({
    page,
    ownerApi,
    venue,
    makeVenue,
  }) => {
    test.setTimeout(120_000);
    const other = await makeVenue();
    const staff = await createStaff(ownerApi, [venue.id, other.id]);
    const mine = await walkIn(ownerApi, venue.turfId, 10, 'PW Mine Guest');
    const theirs = await walkIn(ownerApi, other.turfId, 11, 'PW Theirs Guest');

    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/choose-venue$/);
    await expect(page.getByRole('heading', { name: 'Choose a venue' })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(other.name) })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(venue.name) }).click();

    // Today at the chosen venue: its booking is listed, the other venue's is not.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: `Today at ${venue.name}` })).toBeVisible();
    await expect(page.getByText('PW Mine Guest')).toBeVisible();
    await expect(page.getByText('PW Theirs Guest')).toHaveCount(0);

    // The sidebar has only what staff may use.
    const nav = page.getByRole('navigation');
    for (const label of ['Dashboard', 'Day view', 'Bookings', 'Walk-in booking', 'Notifications']) {
      await expect(nav.getByRole('link', { name: new RegExp(label + '$') })).toBeVisible();
    }
    for (const label of ['My Venues', 'Staff', 'Payments']) {
      await expect(nav.getByRole('link', { name: new RegExp(label + '$') })).toHaveCount(0);
    }

    // A page staff may not open sends them back to the dashboard, which says why.
    await page.goto('/payments');
    await expect(page).toHaveURL(/\/dashboard\?restricted=1$/);

    // Bookings list: scoped to the chosen venue, no venue filter.
    await page.getByRole('navigation').getByRole('link', { name: /Bookings$/ }).click();
    await expect(page.getByRole('row').filter({ hasText: mine.orderId })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: theirs.orderId })).toHaveCount(0);
    await expect(page.getByLabel('Venue', { exact: true })).toHaveCount(1); // the header switcher only

    // Day view, and moving to a day with nothing on.
    await page.getByRole('navigation').getByRole('link', { name: /Day view$/ }).click();
    await expect(page.getByRole('heading', { name: 'Day view', level: 1 })).toBeVisible();
    await expect(page.getByText('PW Mine Guest')).toBeVisible();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByText('No bookings on this day.')).toBeVisible();

    // Walk-in booking opens for the chosen venue, with the per-field messages.
    await page.getByRole('navigation').getByRole('link', { name: /Walk-in booking$/ }).click();
    await expect(page.getByRole('heading', { name: 'Walk-in booking', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Book This Slot' }).click();
    await expect(page.getByText('Choose the date.')).toBeVisible();

    // Switching venue in the header re-scopes everything.
    await page.getByRole('navigation').getByRole('link', { name: /Dashboard$/ }).click();
    await page.getByRole('combobox', { name: 'Venue' }).selectOption({ label: other.name });
    await expect(page.getByRole('heading', { name: `Today at ${other.name}` })).toBeVisible();
    await expect(page.getByText('PW Theirs Guest')).toBeVisible();
    await expect(page.getByText('PW Mine Guest')).toHaveCount(0);
  });

  test('a staff member the owner blocks is signed out at once, not when their session runs out', async ({ page, ownerApi, venue }) => {
    const staff = await createStaff(ownerApi, [venue.id], 'Blocked');
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/dashboard$/);

    // The owner blocks them while they are signed in and the portal is open.
    const blocked = await ownerApi.patch(`/owner/staff/${staff.id}/status`, { data: { status: 'DISABLED' } });
    expect(blocked.ok(), await blocked.text()).toBeTruthy();

    // Their very next move in the portal ends at the sign-in page, instead of carrying on with a session that should be gone.
    await page.getByRole('navigation').getByRole('link', { name: /Bookings$/ }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/login$/); // and they cannot sign back in
  });

  // This group starts signed out (staff sign in themselves); deleting staff is the owner admin's job, so use their saved sign-in.
  test.describe('deleting a login', () => {
  test.use({ storageState: '.auth/owner.json' });
  test('a staff login is deleted only by holding the button: a click or a short press does nothing', async ({ page, ownerApi, venue }) => {
    const staff = await createStaff(ownerApi, [venue.id], 'Doomed');
    await page.goto('/staff');
    await page.getByLabel('Search staff').fill(staff.email);
    const row = page.getByRole('row').filter({ hasText: staff.email });
    await row.getByRole('button', { name: `Delete ${staff.name}` }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading', { name: `Delete ${staff.name}?` })).toBeVisible();
    await expect(dialog).toContainText('cannot undo');
    const hold = dialog.getByRole('button', { name: /press and hold/ });
    await expect(hold).toContainText('Hold to delete');
    // It is the same height as Cancel beside it.
    const cancelBox = (await dialog.getByRole('button', { name: 'Cancel' }).boundingBox())!;
    expect(Math.abs((await hold.boundingBox())!.height - cancelBox.height)).toBeLessThan(1);

    // A plain click, and a hold that is let go too early, change nothing and say what to do.
    await hold.click();
    await expect(dialog.getByText('Keep holding the button until it fills.')).toBeVisible();
    const box = (await hold.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await expect(hold).toContainText('Keep holding');
    await page.mouse.up();
    await expect(hold).toContainText('Hold to delete');
    expect((await ownerApi.get('/owner/staff?search=' + encodeURIComponent(staff.email))).ok()).toBeTruthy();
    await expect(row).toBeVisible();

    // Cancel closes it without deleting.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeVisible();

    // Holding it all the way deletes the login.
    await row.getByRole('button', { name: `Delete ${staff.name}` }).click();
    const hold2 = page.getByRole('alertdialog').getByRole('button', { name: /press and hold/ });
    const box2 = (await hold2.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await expect(page.getByText(`${staff.name} was deleted.`)).toBeVisible({ timeout: 10_000 });
    await page.mouse.up();
    await expect(row).toHaveCount(0);

    // They cannot sign in any more.
    const api = await ownerApi.get('/owner/staff?search=' + encodeURIComponent(staff.email));
    expect(await api.json()).toEqual([]);
  });
  });

  test('staff with a single venue skip the chooser', async ({ page, ownerApi, venue }) => {
    const staff = await createStaff(ownerApi, [venue.id], 'Solo');
    await signIn(page, staff.email, staff.password);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: `Today at ${venue.name}` })).toBeVisible();
  });
});
