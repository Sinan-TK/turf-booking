import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, CSP_HEADER, CSP_REPORT_ONLY_HEADER, cspMode, newNonce, originOf, originsFromList } from '@venue/shared/dist/csp';

/**
 * Content Security Policy for the customer site, with a fresh nonce per request. CSP_MODE=report-only only reports what would be
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
    imgOrigins: originsFromList(process.env.CSP_IMG_ORIGINS),
    // Only for browsers without 'strict-dynamic'; the others trust what the nonced scripts load.
    scriptOrigins: ['https://accounts.google.com', 'https://checkout.razorpay.com'],
    // Google sign-in injects its button styles as an inline <style>; without this the button renders broken (checked in enforce mode).
    allowInlineStyleElements: true,
    styleOrigins: ['https://accounts.google.com/gsi/style'],
    connectOrigins: ['https://accounts.google.com', 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
    frameOrigins: ['https://accounts.google.com', 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
    reportUri: apiOrigin ? `${apiOrigin}/csp-report?app=web` : undefined,
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
