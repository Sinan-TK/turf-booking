import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';

/**
 * A venue owner's own sign-up waits for the Super Admin. The page is shown an organization that is waiting (the answer is supplied, so no
 * real sign-up or email is made) and the choice made on it is what is sent.
 */
test.describe('admin: approving an owner sign-up', () => {
  test('a waiting organization shows Approve and Reject, and Approve sends the approval', async ({ page, adminApi }) => {
    // Any real organization will do; the page is told it is waiting.
    const created = await adminApi.post('/admin/organizations', { data: { name: `PW Waiting ${Date.now()}`, contactEmail: 'pw-waiting@example.com', contactPhone: '9847012345' } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const org = (await created.json()) as { id: string; name: string };

    let status = 'PENDING_APPROVAL';
    const patches: Array<Record<string, unknown>> = [];
    await page.route(`${URLS.api}/admin/organizations/${org.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      const detail = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...detail, status } });
    });
    await page.route(`${URLS.api}/admin/organizations/${org.id}/status`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches.push(route.request().postDataJSON() as Record<string, unknown>);
      status = (route.request().postDataJSON() as { status: string }).status;
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ id: org.id, status }) });
    });

    await page.goto(`/owners/${org.id}`);
    const panel = page.getByRole('region', { name: 'Approval' });
    await expect(panel).toContainText('Waiting for your approval');
    await expect(panel.getByRole('button', { name: 'Reject' })).toBeVisible();
    // The suspend control is not offered for an organization that is not yet approved.
    await expect(page.getByRole('button', { name: 'Suspend organization' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Approve' }).click();
    await expect(panel).toHaveCount(0);
    expect(patches).toEqual([{ status: 'ACTIVE' }]);
    await expect(page.getByRole('button', { name: 'Suspend organization' })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' }); // an answer still being fetched when the test ends is not an error
  });

  test('Reject asks first, sends the reason, and a refused sign-up can still be approved', async ({ page, adminApi }) => {
    const created = await adminApi.post('/admin/organizations', { data: { name: `PW Refused ${Date.now()}`, contactEmail: 'pw-refused@example.com', contactPhone: '9847012345' } });
    const org = (await created.json()) as { id: string };
    let status = 'PENDING_APPROVAL';
    const patches: Array<Record<string, unknown>> = [];
    await page.route(`${URLS.api}/admin/organizations/${org.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...((await res.json()) as object), status } });
    });
    await page.route(`${URLS.api}/admin/organizations/${org.id}/status`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const sent = route.request().postDataJSON() as { status: string };
      patches.push(sent);
      status = sent.status;
      await route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ id: org.id, status }) });
    });

    await page.goto(`/owners/${org.id}`);
    const panel = page.getByRole('region', { name: 'Approval' });
    await panel.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject this sign-up?' });
    await dialog.getByLabel(/Reason/).fill('Not a real business');
    await dialog.getByRole('button', { name: 'Reject sign-up' }).click();
    await expect(panel).toContainText('This sign-up was refused');
    expect(patches).toEqual([{ status: 'REJECTED', reason: 'Not a real business' }]);
    await expect(panel.getByRole('button', { name: 'Reject' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Approve' }).click();
    await expect(panel).toHaveCount(0);
    expect(patches[1]).toEqual({ status: 'ACTIVE' });
    await page.unrouteAll({ behavior: 'ignoreErrors' }); // an answer still being fetched when the test ends is not an error
  });

  test('the dashboard says how many owners are waiting and the owners list opens filtered to them', async ({ page }) => {
    await page.route(`${URLS.api}/admin/dashboard/summary`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      // The whole answer is supplied (no real request), with two owners waiting.
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': URLS.admin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ totalOrganizations: 3, totalVenues: 4, activeVenues: 3, totalCustomers: 5, bookingsToday: 1, openSupportTickets: 0, ownersPendingApproval: 2, revenueThisMonth: '0' }),
      });
    });
    await page.goto('/dashboard');
    const notice = page.getByRole('link', { name: /2 new owners are waiting for your approval/ });
    await expect(notice).toHaveAttribute('href', '/owners?status=PENDING_APPROVAL');
    await notice.click();
    await expect(page).toHaveURL(/\/owners\?status=PENDING_APPROVAL/);
    await expect(page.getByRole('heading', { name: 'Owner organizations', level: 1 })).toBeVisible();
    await page.unrouteAll({ behavior: 'ignoreErrors' }); // a request still in flight when the test ends is not an error
  });
});
