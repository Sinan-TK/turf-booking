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
