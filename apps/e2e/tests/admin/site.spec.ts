import { request } from '@playwright/test';
import { URLS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

/** The admin's Landing page & sign-in page: the Google switch, and the featured venues with their order. */
test.describe('admin: landing page and sign-in', () => {
  const publicApi = () => request.newContext({ baseURL: URLS.api });

  test('the Google switch turns Google sign-in off and on for the whole site', async ({ page, adminApi }) => {
    const before = ((await (await adminApi.get('/admin/site')).json()) as { googleSignIn: boolean }).googleSignIn;
    const api = await publicApi();
    const siteSays = async () => ((await (await api.get('/site/config')).json()) as { googleSignIn: boolean }).googleSignIn;
    try {
      await page.goto('/site');
      const google = page.getByRole('switch', { name: 'Google sign-in' });
      await expect(google).toHaveAttribute('aria-checked', String(before));
      await google.click();
      await expect(google).toHaveAttribute('aria-checked', String(!before));
      expect(await siteSays()).toBe(!before);
      await google.click();
      await expect(google).toHaveAttribute('aria-checked', String(before));
      expect(await siteSays()).toBe(before);
    } finally {
      await api.dispose();
      await adminApi.put('/admin/site/google', { data: { enabled: before } });
    }
  });

  test('venues are added, moved and removed, and the landing page list follows', async ({ page, adminApi, venue, makeVenue }) => {
    const second = await makeVenue();
    const saved = ((await (await adminApi.get('/admin/site')).json()) as { featured: Array<{ id: string }> }).featured.map((f) => f.id);
    const api = await publicApi();
    const featured = async () => ((await (await api.get('/site/featured-venues')).json()) as Array<{ id: string }>).map((v) => v.id);
    const add = async (id: string, name: string) => {
      await page.getByLabel('Add a venue').selectOption(id);
      await page.getByRole('button', { name: 'Add venue' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
    };
    try {
      await adminApi.put('/admin/site/featured', { data: { venueIds: [] } });
      await page.goto('/site');
      await expect(page.getByText('No venues are featured yet.')).toBeVisible();

      await add(venue.id, venue.name);
      await add(second.id, second.name);
      expect(await featured()).toEqual([venue.id, second.id]);

      await page.getByRole('button', { name: `Move ${second.name} up` }).click();
      await expect.poll(featured).toEqual([second.id, venue.id]);

      await page.getByRole('button', { name: `Remove ${second.name} from featured venues` }).click();
      await expect.poll(featured).toEqual([venue.id]);
      await expect(page.getByRole('listitem').filter({ hasText: second.name })).toHaveCount(0);
    } finally {
      await api.dispose();
      await adminApi.put('/admin/site/featured', { data: { venueIds: saved } });
    }
  });
});
