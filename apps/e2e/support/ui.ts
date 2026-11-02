import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * The control that follows a form label. The apps' <Label> isn't wired to its input with
 * htmlFor, so getByLabel() can't find these fields; this finds the element right after the label.
 */
export const field = (scope: Page | Locator, label: string | RegExp): Locator =>
  scope
    .locator('label')
    .filter({ hasText: label })
    .locator('xpath=following-sibling::*[1]');

/** A table row (or list item) that contains the text. */
export const rowWith = (page: Page, text: string | RegExp): Locator => page.getByRole('row').filter({ hasText: text });

/** Chooses an option in the Super Admin's custom dropdown (a button that opens a listbox), e.g. pick(page, 'Status', 'Active'). */
export async function pick(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page
    .locator('button[aria-haspopup="listbox"]')
    .filter({ hasText: new RegExp(`^\s*${label}`) })
    .click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option }).click();
}

/** The venue page's two sections: opens Units (the tabs of its units and pooled items) or Venue (its details). */
export async function openSection(page: Page, name: 'Venue' | 'Units'): Promise<void> {
  const tab = page.getByRole('tablist', { name: 'Venue sections' }).getByRole('tab', { name: new RegExp('^' + name) });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** Opens a unit's (or pooled item's) tab on the owner's venue page; "New" opens the tab for adding one. */
export async function openUnitTab(page: Page, name: string): Promise<void> {
  await openSection(page, 'Units');
  // Unit names are plain words and numbers ("Turf A", "Court 1"); the tab's name also carries its facility, so match the start.
  const tab = page.getByRole('tablist', { name: 'Units' }).getByRole('tab', { name: name === 'New' ? /^\+?\s*New$/ : new RegExp('^' + name) });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}
