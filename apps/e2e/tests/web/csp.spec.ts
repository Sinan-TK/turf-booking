import { expect, test } from '@playwright/test';
import { scanForViolations } from '../../support/csp';
import { URLS } from '../../support/env';

test.use({ baseURL: URLS.web });

/** The customer site's Content-Security-Policy: set on pages, nonce per request, and nothing the site needs is blocked. */
test.describe('customer site: content security policy', () => {
  test('the page carries a policy that allows Google sign-in and Razorpay but no unsafe-eval or inline scripts, with a new nonce each time', async ({ request }) => {
    const first = await request.get('/');
    const second = await request.get('/');
    const header = first.headers()['content-security-policy'] ?? first.headers()['content-security-policy-report-only'];
    expect(header).toBeTruthy();
    expect(header).toContain('https://accounts.google.com');
    expect(header).toContain('https://checkout.razorpay.com');
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).not.toMatch(/script-src[^;]*'unsafe-(eval|inline)'/);
    const nonce = (h: string | undefined) => /'nonce-([^']+)'/.exec(h ?? '')?.[1];
    const other = second.headers()['content-security-policy'] ?? second.headers()['content-security-policy-report-only'];
    expect(nonce(header)).toBeTruthy();
    expect(nonce(header)).not.toBe(nonce(other));
  });

  test('a policy sent by the visitor is never used', async ({ request }) => {
    const res = await request.get('/', { headers: { 'Content-Security-Policy': "default-src *; script-src 'nonce-attacker'", 'x-nonce': 'attacker' } });
    const header = res.headers()['content-security-policy'] ?? res.headers()['content-security-policy-report-only'] ?? '';
    expect(header).not.toContain('attacker');
    expect(await res.text()).not.toContain('nonce="attacker"');
  });

  test('the public pages run with nothing blocked', async ({ page }) => {
    const seen = await scanForViolations(page, ['/', '/explore', '/support', '/account']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });

  test('with the policy enforced the Google sign-in button still renders at its normal size', async ({ page }) => {
    await page.goto('/account');
    const logo = page.locator('svg').filter({ has: page.locator('path[fill="#EA4335"], path[fill="#ea4335"]') }).first();
    await expect(logo).toBeVisible();
    const box = await logo.boundingBox();
    expect(box!.width).toBeLessThan(60); // unstyled it fills the whole dialog
  });
});
