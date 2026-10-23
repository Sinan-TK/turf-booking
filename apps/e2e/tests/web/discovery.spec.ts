import { request } from '@playwright/test';
import { searchNear, settled, shareLocation } from '../../support/customer-ui';
import { URLS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

const DAY_BUTTON = /^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*\d/;

test.describe('customer site: finding a venue', () => {
  test('the facility chips are exactly the facilities a customer can book right now', async ({ page, venue }) => {
    void venue; // makes sure at least a football turf and a badminton court are bookable
    const api = await request.newContext({ baseURL: URLS.api });
    const bookable = (await (await api.get('/categories?available=true')).json()) as Array<{ name: string }>;
    await page.goto('/');
    const chips = page.getByRole('banner').getByRole('button').filter({ hasText: /^(All|[A-Z][A-Za-z() ]+)$/ });
    await expect(page.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    for (const c of bookable) await expect(page.getByRole('banner').getByRole('button', { name: c.name, exact: true })).toBeVisible();
    // A facility nobody can book (the catalogue has many) is not offered.
    const all = (await (await api.get('/categories')).json()) as Array<{ name: string }>;
    const unbookable = all.filter((c) => !bookable.some((b) => b.name === c.name));
    expect(unbookable.length).toBeGreaterThan(0);
    for (const c of unbookable.slice(0, 3)) await expect(page.getByRole('banner').getByRole('button', { name: c.name, exact: true })).toHaveCount(0);
    void chips;
  });

  test('searching near a venue shows a card per unit with slots, prices and the hours its prices set', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);

    // Look at a day a few days ahead so the whole day is on offer.
    await page.getByRole('button', { name: DAY_BUTTON }).nth(3).click();
    await settled(page);
    const chip = (await page.getByRole('button', { name: DAY_BUTTON }).nth(3).innerText()).trim();
    const weekend = /^(Sat|Sun)/.test(chip);

    const turf = page.locator('article').filter({ hasText: remoteVenue.name }).filter({ hasText: 'Turf A' });
    const court = page.locator('article').filter({ hasText: remoteVenue.name }).filter({ hasText: 'Court 1' });
    await expect(turf).toHaveCount(1);
    await expect(court).toHaveCount(1);
    await expect(turf).toContainText('5S');
    await expect(court).not.toContainText('Court 1 ·'); // a unit with no type has no dangling separator
    await expect(turf.getByRole('link', { name: 'Directions' })).toBeVisible();

    // The turf is priced 6 AM-10 PM (Mon-Fri 800, Sat-Sun 1000); the court is priced all day at 300.
    const turfPrice = weekend ? '₹1000' : '₹800';
    await expect(turf.getByRole('button', { name: new RegExp(`^6:00 AM ${turfPrice}`) })).toBeVisible();
    await expect(turf.getByRole('button', { name: new RegExp(`^9:00 PM ${turfPrice}`) })).toBeVisible();
    await expect(turf.getByRole('button', { name: /^5:00 AM/ })).toHaveCount(0); // before the first priced hour
    await expect(turf.getByRole('button', { name: /^10:00 PM/ })).toHaveCount(0); // a 1-hour slot would end after 10 PM
    await expect(court.getByRole('button', { name: /^12:00 AM ₹300/ })).toBeVisible();
    await expect(court.getByRole('button', { name: /^11:00 PM ₹300/ })).toBeVisible();
  });

  test('the facility chips narrow the results to that facility', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    const turf = page.locator('article').filter({ hasText: remoteVenue.name }).filter({ hasText: 'Turf A' });
    const court = page.locator('article').filter({ hasText: remoteVenue.name }).filter({ hasText: 'Court 1' });
    const chips = page.getByRole('banner');

    // Two days ahead, so the result never depends on what time of day the suite runs (late today has no slots left).
    await page.getByRole('button', { name: /\d+ [A-Za-z]{3}$/ }).nth(2).click();
    await chips.getByRole('button', { name: 'Football Turf', exact: true }).click();
    await settled(page);
    await expect(turf).toHaveCount(1);
    await expect(court).toHaveCount(0);

    await chips.getByRole('button', { name: 'Badminton Court', exact: true }).click();
    await settled(page);
    await expect(court).toHaveCount(1);
    await expect(turf).toHaveCount(0);

    await chips.getByRole('button', { name: 'Swimming Pool (entire)', exact: true }).click();
    await settled(page);
    await expect(page.locator('article').filter({ hasText: remoteVenue.name })).toHaveCount(0);

    await chips.getByRole('button', { name: 'All', exact: true }).click();
    await settled(page);
    await expect(turf).toHaveCount(1);
    await expect(court).toHaveCount(1);
  });

  test('the search box narrows by venue name', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    await page.getByPlaceholder('Search venues, names or areas...').fill('zzz-no-such-venue-zzz');
    await expect(page.locator('article')).toHaveCount(0);
    await page.getByPlaceholder('Search venues, names or areas...').fill(remoteVenue.name);
    await expect(page.locator('article').filter({ hasText: remoteVenue.name }).first()).toBeVisible();
  });
});
