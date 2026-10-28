import { expect, test } from '../../support/fixtures';
import { unique } from '../../support/env';

/** The staff list is paged on the server (25 a time) and searched by name or email. */
test.describe('owner portal: staff list paging', () => {
  test('more than 25 staff are paged, and the search finds one of them on any page', async ({ page, ownerApi, venue }) => {
    test.setTimeout(180_000);
    const tag = unique();
    const names: string[] = [];
    for (let i = 0; i < 27; i++) {
      const name = `PW Pager ${tag} ${String(i).padStart(2, '0')}`;
      const res = await ownerApi.post('/owner/staff', {
        data: { name, email: `pw-pager-${tag}-${i}@example.com`, venueIds: [venue.id] },
      });
      expect(res.ok(), `invite failed: ${await res.text()}`).toBeTruthy();
      names.push(name);
    }

    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible();
    const pager = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pager).toBeVisible();
    await expect(pager).toContainText(/^1–25 of \d+/);
    await expect(page.getByRole('row')).toHaveCount(26); // 25 staff and the header

    await pager.getByRole('button', { name: 'Next' }).click();
    await expect(pager).toContainText(/^26–/);
    await pager.getByRole('button', { name: 'Previous' }).click();
    await expect(pager).toContainText(/^1–25 of /);

    // Searching narrows the whole list, not only the page on screen.
    await page.getByLabel('Search staff').fill(`PW Pager ${tag} 26`);
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByText(names[26]!)).toBeVisible();
    await expect(pager).toHaveCount(0);

    await page.getByLabel('Search staff').fill('zzz-no-such-staff-zzz');
    await expect(page.getByText('No staff match your search or filters.')).toBeVisible();
  });

  test('the status filter shows only disabled logins', async ({ page, ownerApi, venue }) => {
    const tag = unique();
    const made = await ownerApi.post('/owner/staff', { data: { name: `PW Off ${tag}`, email: `pw-off-${tag}@example.com`, venueIds: [venue.id] } });
    expect(made.ok(), await made.text()).toBeTruthy();
    const staffId = (await made.json()).id as string;
    expect((await ownerApi.patch(`/owner/staff/${staffId}/status`, { data: { status: 'DISABLED' } })).ok()).toBeTruthy();

    const disabled = await ownerApi.get('/owner/staff?status=DISABLED&search=' + encodeURIComponent(`PW Off ${tag}`));
    expect((await disabled.json()).map((s: { id: string }) => s.id)).toEqual([staffId]);
    expect(Number(disabled.headers()['x-total-count'])).toBe(1);
    const active = await ownerApi.get('/owner/staff?status=ACTIVE&search=' + encodeURIComponent(`PW Off ${tag}`));
    expect(await active.json()).toEqual([]);
    expect((await ownerApi.get('/owner/staff?status=bogus')).status()).toBe(400);
    expect((await ownerApi.get('/owner/staff?limit=abc')).status()).toBe(400);
  });
});
