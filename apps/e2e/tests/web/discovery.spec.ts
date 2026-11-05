import { request } from '@playwright/test';
import { openBooking, openVenueTypes, searchNear, settled, shareLocation } from '../../support/customer-ui';
import { URLS } from '../../support/env';
import { expect, test } from '../../support/fixtures';

const DAY_BUTTON = /^(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*\d/;

test.describe('customer site: finding a venue', () => {
  test('the venue types on offer are exactly the facilities a customer can book right now', async ({ page, venue }) => {
    void venue; // makes sure at least a football turf and a badminton court are bookable
    const api = await request.newContext({ baseURL: URLS.api });
    const bookable = (await (await api.get('/categories?available=true')).json()) as Array<{ name: string }>;
    await page.goto('/explore');
    const picker = await openVenueTypes(page);
    for (const c of bookable) await expect(picker.getByRole('checkbox', { name: c.name, exact: true })).toBeVisible();
    // A facility nobody can book (the catalogue has many) is not offered.
    const all = (await (await api.get('/categories')).json()) as Array<{ name: string }>;
    const unbookable = all.filter((c) => !bookable.some((b) => b.name === c.name));
    expect(unbookable.length).toBeGreaterThan(0);
    for (const c of unbookable.slice(0, 3)) await expect(picker.getByRole('checkbox', { name: c.name, exact: true })).toHaveCount(0);
  });

  test('searching near a venue shows a card per unit with slots, prices and the hours its prices set', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);

    // Look at a day a few days ahead so the whole day is on offer.
    await page.getByRole('button', { name: DAY_BUTTON }).nth(3).click();
    await settled(page);
    const chip = (await page.getByRole('button', { name: DAY_BUTTON }).nth(3).innerText()).trim();
    const weekend = /^(Sat|Sun)/.test(chip);

    // One card for the venue, with both of its units inside it: its name, address and Directions are shown once.
    const card = page.locator('article').filter({ hasText: remoteVenue.name });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: remoteVenue.name })).toHaveCount(1);
    await expect(card.getByRole('link', { name: 'Directions' })).toHaveCount(1);
    // The turf is priced 6 AM-10 PM (Mon-Fri 800, Sat-Sun 1000); the court is priced all day at 300.
    const turfPrice = weekend ? '₹1,000' : '₹800'; // prices read with a thousands separator
    // One tab per unit, each with its lowest price; one unit is shown at a time.
    await expect(card.getByRole('tab')).toHaveCount(2);
    await expect(card.getByRole('tab', { name: new RegExp('^Turf A ' + turfPrice) })).toHaveAttribute('aria-selected', 'true');
    await expect(card.getByRole('tab', { name: /^Court 1 ₹300/ })).toBeVisible();
    // The day's timeline: an hour cell is there only where a price covers it (6 AM-10 PM for the turf).
    const turf = card.getByRole('group', { name: /^Turf A, / });
    await expect(turf.getByRole('button', { name: 'Book 6:00 AM' })).toBeVisible();
    await expect(turf.getByRole('button', { name: 'Book 9:00 PM' })).toBeVisible();
    await expect(turf.getByRole('button', { name: 'Book 5:00 AM' })).toHaveCount(0); // before the first priced hour
    await expect(turf.getByRole('button', { name: 'Book 10:00 PM' })).toHaveCount(0); // a 1-hour slot would end after 10 PM
    await expect(card.getByRole('link', { name: 'Directions' })).toBeVisible();

    // Book Now lists every start time with its price, and the unit's type.
    const window = await openBooking(page, remoteVenue.name);
    await expect(window).toContainText('Turf A · 5S');
    await expect(window.getByRole('button', { name: new RegExp('^6:00 AM ' + turfPrice) })).toBeVisible();
    await expect(window.getByRole('button', { name: new RegExp('^9:00 PM ' + turfPrice) })).toBeVisible();
    await expect(window.getByRole('button', { name: /^5:00 AM/ })).toHaveCount(0);
    await expect(window.getByRole('button', { name: /^10:00 PM/ })).toHaveCount(0);
    await page.goBack(); // the booking page is a page of its own: back returns to the listing (on today again)
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: DAY_BUTTON }).nth(3).click();
    await settled(page);

    await card.getByRole('tab', { name: /^Court 1/ }).click();
    await expect(card.getByRole('group', { name: /^Turf A, / })).toHaveCount(0);
    const court = card.getByRole('group', { name: /^Court 1, / });
    await expect(court.getByRole('button', { name: 'Book 12:00 AM' })).toBeVisible();
    await expect(court.getByRole('button', { name: 'Book 11:00 PM' })).toBeVisible();
    const courtWindow = await openBooking(page, remoteVenue.name);
    await expect(courtWindow.getByRole('tab', { name: /^Court 1/ })).not.toContainText('·'); // a unit with no sub-type shows none
    await expect(courtWindow.getByRole('button', { name: /^12:00 AM ₹300/ })).toBeVisible();
    await expect(courtWindow.getByRole('button', { name: /^11:00 PM ₹300/ })).toBeVisible();
  });

  test('the venue types narrow the results to that facility', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    const card = page.locator('article').filter({ hasText: remoteVenue.name });

    // Two days ahead, so the result never depends on what time of day the suite runs (late today has no slots left).
    await page.getByRole('button', { name: /\d+ [A-Za-z]{3}$/ }).nth(2).click();
    await settled(page);

    // The facilities' names are the Super Admin's to change, so they are looked up by their fixed codes, never typed here.
    const api = await request.newContext({ baseURL: URLS.api });
    const all = (await (await api.get('/categories')).json()) as Array<{ slug: string; name: string }>;
    const nameOf = (slug: string) => all.find((c) => c.slug === slug)!.name;

    // Pick one type, apply it, then look at the card.
    const pick = async (name: string) => {
      const picker = await openVenueTypes(page);
      await picker.getByRole('button', { name: 'Clear all' }).click().catch(() => undefined);
      await picker.getByRole('checkbox', { name, exact: true }).check();
      await picker.getByRole('contentinfo').getByRole('button').last().click();
      await expect(page.getByRole('dialog', { name: 'Venue types' })).toHaveCount(0);
      await settled(page);
    };

    await pick(nameOf('FOOTBALL_TURF'));
    await expect(card.getByRole('group', { name: /^Turf A, / })).toHaveCount(1);
    await expect(card).not.toContainText('Court 1');

    await pick(nameOf('BADMINTON'));
    await expect(card.getByRole('group', { name: /^Court 1, / })).toHaveCount(1);
    await expect(card).not.toContainText('Turf A');

    await pick(nameOf('KAYAKING'));
    await expect(card).toHaveCount(0);

    // No type picked shows every type again.
    const picker = await openVenueTypes(page);
    await picker.getByRole('button', { name: 'Clear all' }).click();
    await picker.getByRole('contentinfo').getByRole('button').last().click();
    await settled(page);
    await expect(card.getByRole('tab')).toHaveCount(2);
  });

  test('the search box narrows by venue name', async ({ page, context, remoteVenue }) => {
    await shareLocation(context, remoteVenue.lat, remoteVenue.lng);
    await searchNear(page, remoteVenue.name);
    await page.getByPlaceholder('Search venues, turfs, pools').fill('zzz-no-such-venue-zzz');
    await expect(page.locator('article')).toHaveCount(0);
    await page.getByPlaceholder('Search venues, turfs, pools').fill(remoteVenue.name);
    await expect(page.locator('article').filter({ hasText: remoteVenue.name }).first()).toBeVisible();
  });
});
