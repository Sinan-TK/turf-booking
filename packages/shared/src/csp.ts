/**
 * Content Security Policy for the three web apps. One builder so each app states only what it needs beyond the common base.
 * Pure string code (no Node imports) so it runs in the Next.js middleware.
 *
 * Scripts: only our own files and the ones that carry this request's nonce, plus what those load ('strict-dynamic': Google sign-in
 * and Razorpay checkout are loaded that way). No 'unsafe-inline' for scripts, and 'unsafe-eval' only for the development server.
 * Styles: our own files and Google Fonts. Style ATTRIBUTES (style="…" in the page HTML) need 'unsafe-inline' in style-src-attr, which
 * is far narrower than allowing inline <style> blocks: it cannot run script or load anything.
 */

export type CspMode = 'enforce' | 'report-only' | 'off';

export interface CspOptions {
  nonce: string;
  /** The development server needs 'unsafe-eval' (React refresh); production never gets it. */
  dev?: boolean;
  /** Origin of the API: where the app fetches from, and where uploaded photos can come from. Empty if unknown. */
  apiOrigin?: string;
  /** Extra places images may come from (the photo storage bucket). */
  imgOrigins?: string[];
  /** Extra script hosts, used only by browsers without 'strict-dynamic'. */
  scriptOrigins?: string[];
  styleOrigins?: string[];
  /**
   * Lets <style> elements made by a script run. Only for the customer site: Google sign-in builds its button's styles as an inline
   * <style> and the button renders broken without it. Style elements cannot run script; this is the narrowest way to allow them.
   */
  allowInlineStyleElements?: boolean;
  connectOrigins?: string[];
  frameOrigins?: string[];
  /** Where violation reports are sent (the API's /csp-report). */
  reportUri?: string;
}

/** The origin of a URL ("https://api.example.com"), or '' when it is not an http(s) URL. */
export function originOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : '';
  } catch {
    return '';
  }
}

/** Comma/space separated origins from a setting, keeping only valid http(s) origins. */
export function originsFromList(list: string | undefined | null): string[] {
  return (list ?? '')
    .split(/[\s,]+/)
    .map(originOf)
    .filter((o) => o !== '');
}

export function cspMode(value: string | undefined | null, production: boolean): CspMode {
  if (value === 'enforce' || value === 'report-only' || value === 'off') return value;
  return production ? 'enforce' : 'report-only';
}

const unique = (list: Array<string | undefined>) => Array.from(new Set(list.filter((v): v is string => !!v)));

export function buildCsp(o: CspOptions): string {
  const api = o.apiOrigin ?? '';
  const secureApi = api.startsWith('https://');
  const styleSrc = unique(["'self'", 'https://fonts.googleapis.com', ...(o.styleOrigins ?? [])]);
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', unique(["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", o.dev ? "'unsafe-eval'" : undefined, ...(o.scriptOrigins ?? [])])],
    ['style-src', styleSrc],
    ...(o.allowInlineStyleElements ? ([['style-src-elem', [...styleSrc, "'unsafe-inline'"]]] as Array<[string, string[]]>) : []),
    ['style-src-attr', ["'unsafe-inline'"]],
    ['font-src', ["'self'", 'https://fonts.gstatic.com']],
    ['img-src', unique(["'self'", 'data:', 'blob:', api, ...(o.imgOrigins ?? [])])],
    ['connect-src', unique(["'self'", api, ...(o.connectOrigins ?? [])])],
    ['frame-src', o.frameOrigins && o.frameOrigins.length > 0 ? unique(o.frameOrigins) : ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(' ')}`);
  if (secureApi) parts.push('upgrade-insecure-requests');
  if (o.reportUri) parts.push(`report-uri ${o.reportUri}`);
  return parts.join('; ');
}

/** A fresh, unguessable nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export const CSP_HEADER = 'Content-Security-Policy';
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
