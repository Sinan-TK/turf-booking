import { expect, test } from '../../support/fixtures';
import { scanForViolations } from '../../support/csp';
import { URLS } from '../../support/env';

/** The admin portal's Content-Security-Policy: set on pages, nonce per request, and nothing the app needs is blocked. */
test.describe('admin: content security policy', () => {
  test('the page carries a policy without unsafe-eval or an inline-script allowance, and a new nonce each time', async ({ request }) => {
    const first = await request.get('/login');
    const second = await request.get('/login');
    const header = first.headers()['content-security-policy'] ?? first.headers()['content-security-policy-report-only'];
    expect(header).toBeTruthy();
    expect(header).toContain("default-src 'self'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).not.toMatch(/script-src[^;]*'unsafe-(eval|inline)'/);
    const nonce = (h: string | undefined) => /'nonce-([^']+)'/.exec(h ?? '')?.[1];
    const other = second.headers()['content-security-policy'] ?? second.headers()['content-security-policy-report-only'];
    expect(nonce(header)).toBeTruthy();
    expect(nonce(header)).not.toBe(nonce(other));
  });

  test('a policy sent by the visitor is never used: the nonce on the page is the one the server made', async ({ request }) => {
    const hostile = "default-src *; script-src 'unsafe-inline' 'nonce-attacker'";
    const res = await request.get('/login', { headers: { 'Content-Security-Policy': hostile, 'x-nonce': 'attacker' } });
    const header = res.headers()['content-security-policy'] ?? res.headers()['content-security-policy-report-only'] ?? '';
    expect(header).not.toContain('attacker');
    expect(header).not.toContain('default-src *');
    expect(await res.text()).not.toContain('nonce="attacker"');
  });

  test('the main pages, including the map picker, run with nothing blocked', async ({ page }) => {
    const seen = await scanForViolations(page, ['/dashboard', '/venues', '/venues/new', '/venue-types', '/bookings', '/payouts', '/audit-log', '/support']);
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });

  test('the sign-in page runs with nothing blocked', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: URLS.admin });
    const page = await ctx.newPage();
    const seen = await scanForViolations(page, ['/login']);
    await ctx.close();
    expect(seen, JSON.stringify(seen, null, 1)).toEqual([]);
  });
});
