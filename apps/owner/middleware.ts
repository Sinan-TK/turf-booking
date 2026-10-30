import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, CSP_HEADER, CSP_REPORT_ONLY_HEADER, cspMode, newNonce, originOf, originsFromList } from '@venue/shared/dist/csp';

/**
 * Content Security Policy for the owner portal, with a fresh nonce per request. CSP_MODE=report-only only reports what would be
 * blocked; enforce (the default in production) blocks it; off removes the header.
 */
export function middleware(request: NextRequest) {
  const mode = cspMode(process.env.CSP_MODE, process.env.NODE_ENV === 'production');
  // Anything a visitor sends under these names is discarded: the page must only ever see the nonce made here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(CSP_HEADER);
  requestHeaders.delete(CSP_REPORT_ONLY_HEADER);
  requestHeaders.delete('x-nonce');
  if (mode === 'off') return NextResponse.next({ request: { headers: requestHeaders } });

  const nonce = newNonce();
  const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_URL);
  const policy = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== 'production',
    apiOrigin,
    // Map pins (Leaflet, from unpkg) and map tiles (OpenStreetMap).
    imgOrigins: ['https://unpkg.com', 'https://*.tile.openstreetmap.org', ...originsFromList(process.env.CSP_IMG_ORIGINS)],
    reportUri: apiOrigin ? `${apiOrigin}/csp-report?app=owner` : undefined,
  });
  const header = mode === 'enforce' ? CSP_HEADER : CSP_REPORT_ONLY_HEADER;
  // Next reads the nonce from the request's policy and puts it on its own scripts.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(header, policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

export const config = {
  // Pages only: static files and images carry no scripts of their own.
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)' }],
};
