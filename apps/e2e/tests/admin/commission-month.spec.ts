import { expect, test } from '../../support/fixtures';

/** The commission cap and the commission tiers count per calendar month; the admin sees how far a venue is into it. */
test.describe('admin: commission usage this month', () => {
  test('a venue lists each facility with this month\'s bookings, commission and when the month starts over', async ({ adminApi, ownerApi, venue }) => {
    const res = await adminApi.get(`/admin/venues/${venue.id}/commission-month`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const rows = (await res.json()) as Array<{
      facility: string;
      month: string;
      resetsOn: string;
      bookings: number;
      commission: string;
      capRemaining: string | null;
      capReached: boolean;
    }>;
    expect(rows.map((r) => r.facility).sort()).toEqual(['Badminton Court', 'Football Turf']);

    // The month is the venue's own (India): "2026-10" style, and it starts over on the 1st of the next month at local midnight.
    const istNow = new Date(Date.now() + 330 * 60_000);
    const month = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}`;
    for (const r of rows) {
      expect(r.month).toBe(month);
      expect(r.bookings).toBe(0);
      expect(Number(r.commission)).toBe(0);
      expect(r.capReached).toBe(false);
      const resets = new Date(new Date(r.resetsOn).getTime() + 330 * 60_000);
      expect(resets.getUTCDate()).toBe(1);
      expect(resets.getUTCHours() + resets.getUTCMinutes()).toBe(0);
      expect(resets.getTime()).toBeGreaterThan(istNow.getTime());
    }

    // Only the Super Admin sees it, and an unknown venue is a 404.
    expect((await ownerApi.get(`/admin/venues/${venue.id}/commission-month`)).status()).toBe(403);
    expect((await adminApi.get('/admin/venues/00000000-0000-4000-8000-000000000000/commission-month')).status()).toBe(404);
  });

  test('the venue\'s Commercial terms tab shows the cap used and when it starts over', async ({ page, makeVenue, adminApi }) => {
    const venue = await makeVenue();
    // Give the football turf a cap of its own, as the terms editor does.
    const put = await adminApi.put(`/admin/venues/${venue.id}/facilities/${(await categoryId(adminApi, 'Football Turf'))}/commercial-terms`, {
      data: { monthlyCommissionCap: 1234 },
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await page.goto(`/venues/${venue.id}`);
    await page.getByRole('tab', { name: 'Commercial terms' }).click();
    await expect(page.getByText(/0 played bookings · ₹0 commission of ₹1,234 cap/)).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Commission cap used' }).first()).toBeVisible(); // one per facility with a cap
    await expect(page.getByText(/₹1,234 until the cap\. Starts over on \d+ \w+\./)).toBeVisible();
  });
});

async function categoryId(adminApi: import('@playwright/test').APIRequestContext, name: string): Promise<string> {
  const categories = (await (await adminApi.get('/categories')).json()) as Array<{ id: string; name: string }>;
  return categories.find((c) => c.name === name)!.id;
}
