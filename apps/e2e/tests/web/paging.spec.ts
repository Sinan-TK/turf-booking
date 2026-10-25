import type { Route } from '@playwright/test';
import { createVenue } from '../../support/api';
import { shareLocation } from '../../support/customer-ui';
import { expect, test } from '../../support/fixtures';

/** Holds an API answer back a moment, so the "loading more" animation can be seen. */
const slow = (ms: number) => async (route: Route) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await route.continue().catch(() => undefined);
};

test.describe('customer site: results load ten at a time', () => {
  test('ten cards first, the next ones when scrolling, with a loading animation, until the end', async ({ page, context, ownerApi, adminApi }) => {
    test.setTimeout(240_000);
    // Seven venues of two units each at their own spot: fourteen cards, so there are two pages.
    const lat = 8 + Math.random() * 10;
    const lng = 60 + Math.random() * 10;
    const names: string[] = [];
    for (let i = 0; i < 7; i++) names.push((await createVenue(ownerApi, adminApi, { lat, lng })).name);

    await shareLocation(context, lat, lng);
    await page.goto('/');
    await page.getByRole('button', { name: /Change location/ }).click();
    await page.getByRole('dialog', { name: 'Choose your location' }).getByRole('button', { name: 'Use my current location' }).click();
    // Two days ahead, so the cards have open slots at any hour of the day.
    await page.getByRole('button', { name: /[0-9]+ [A-Za-z]{3}$/ }).nth(2).click();

    const cards = page.getByRole('heading', { name: /^PW Venue / });
    await expect(cards).toHaveCount(10); // the first page, not all fourteen
    await expect(page.getByText('That is every venue for this search.')).toHaveCount(0);

    // Scrolling to the end brings the next ones, behind a loading animation.
    await page.route('**/search?*cursor=*', slow(2500));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const loadingMore = page.getByRole('status').filter({ hasText: 'Loading more venues…' });
    await expect(loadingMore).toBeVisible();
    await expect(loadingMore.locator('.animate-spin')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Loading the next venues' }).locator('.animate-pulse').first()).toBeVisible();
    await expect(cards).toHaveCount(14, { timeout: 30_000 });
    await expect(loadingMore).toHaveCount(0);
    await expect(page.getByText('That is every venue for this search.')).toBeVisible();

    // Every card appears once, and the venues named in this test are all there.
    const shown = await cards.allTextContents();
    expect(new Set(shown.map((t) => t.trim())).size).toBe(7);
    for (const name of names) expect(shown.map((t) => t.trim())).toContain(name);
  });

  test('the search box narrows the whole list, not only what has been loaded', async ({ page, context, ownerApi, adminApi }) => {
    test.setTimeout(240_000);
    const lat = 8 + Math.random() * 10;
    const lng = 60 + Math.random() * 10;
    const venues = [];
    for (let i = 0; i < 7; i++) venues.push(await createVenue(ownerApi, adminApi, { lat, lng }));
    const last = venues[venues.length - 1]!; // far down the list, past the first ten cards

    await shareLocation(context, lat, lng);
    await page.goto('/');
    await page.getByRole('button', { name: /Change location/ }).click();
    await page.getByRole('dialog', { name: 'Choose your location' }).getByRole('button', { name: 'Use my current location' }).click();
    await page.getByRole('button', { name: /[0-9]+ [A-Za-z]{3}$/ }).nth(2).click();
    await expect(page.getByRole('heading', { name: /^PW Venue / })).toHaveCount(10);

    await page.getByPlaceholder('Search venues, names or areas...').fill(last.name);
    await expect(page.getByRole('heading', { name: last.name }).first()).toBeVisible(); // found although it was not among the first ten
    await expect(page.getByRole('heading', { name: /^PW Venue / })).toHaveCount(2); // its two units
  });
});
