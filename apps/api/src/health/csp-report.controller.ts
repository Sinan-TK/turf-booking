import { Body, Controller, HttpCode, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

const MAX = 300;

/** Keeps a reported value short and on one line, and drops any query string or fragment so a token in a URL is never stored. */
function clean(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.split('?')[0].split('#')[0].replace(/[\r\n\t]+/g, ' ').slice(0, MAX);
}

/**
 * Where browsers send Content-Security-Policy violation reports from the three web apps. Public (browsers send no cookies), so it is
 * throttled, answers nothing, and writes only a few cleaned-up fields to the log: nothing here is trusted or stored.
 */
@Controller('csp-report')
export class CspReportController {
  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  report(@Body() body: unknown, @Query('app') app?: string) {
    const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const r = (raw['csp-report'] && typeof raw['csp-report'] === 'object' ? raw['csp-report'] : raw) as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.warn(
      '[csp]',
      JSON.stringify({
        app: ['web', 'admin', 'owner'].includes(app ?? '') ? app : 'unknown',
        directive: clean(r['effective-directive'] ?? r['violated-directive']),
        blocked: clean(r['blocked-uri']),
        page: clean(r['document-uri']),
        disposition: clean(r['disposition']),
      }),
    );
  }
}
