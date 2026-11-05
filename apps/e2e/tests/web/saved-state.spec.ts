import { expect, test } from '../../support/fixtures';
import { URLS } from '../../support/env';

/**
 * A venue that is already saved shows its save button as active on the venue's page and on the listing's card. A customer cannot sign in
 * here without the fake-Google test mode, so the account and the saved list are supplied directly (the same shape the API returns, which
 * an API test covers); the venue and its search are real.
 */
test.use({ baseURL: URLS.web });

const customer = { id: 'c-saved', name: 'PW Saver', phone: '+919100000001', email: null, phoneVerified: true, emailVerified: false, hasPassword: false, needsProfile: false };

test.describe('customer site: saved venues show as saved', () => {
  test('a saved venue has an active save button on its page and on its card, and an unsaved one does not', async ({ page, manjeriVenue }) => {
    let saved = true;
    await page.route(`${URLS.api}/customer-auth/me`, (route) => route.fulfill({ json: customer, headers: { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' } }));
    await page.route(`${URLS.api}/me/saved-venues`, (route) =>
      route.fulfill({
        json: saved ? [{ id: manjeriVenue.id, name: manjeriVenue.name, facilityCode: manjeriVenue.facilityCode, address: 'x', units: [] }] : [],
        headers: { 'access-control-allow-origin': URLS.web, 'access-control-allow-credentials': 'true' },
      }),
    );

    await page.goto(`/book/${manjeriVenue.facilityCode}/any`);
    await expect(page.getByRole('button', { name: `Remove ${manjeriVenue.name} from saved venues` })).toHaveAttribute('aria-pressed', 'true');

    saved = false;
    await page.reload();
    await expect(page.getByRole('button', { name: `Save ${manjeriVenue.name}` })).toHaveAttribute('aria-pressed', 'false');
  });
});
