import type { Page } from '@playwright/test';

export interface Violation {
  page: string;
  directive: string;
  blocked: string;
  disposition: string;
  sample: string;
}

/**
 * Opens each path and returns every Content-Security-Policy violation the browser raised on any of them, whether the policy is
 * enforced or only reported. Each one is handed to the test the moment it happens, so a later navigation cannot lose it.
 */
export async function scanForViolations(page: Page, paths: string[]): Promise<Violation[]> {
  const all: Violation[] = [];
  await page.exposeFunction('__reportCsp', (v: Violation) => all.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __reportCsp?: (v: unknown) => void }).__reportCsp?.({
        page: location.pathname,
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
        sample: (e.sample || '').slice(0, 80),
      });
    });
  });
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);
  }
  return all;
}
