/**
 * A venue's optional Google Maps link (what its Directions button opens). Only real Google Maps addresses are
 * accepted, so a venue can't send customers to an arbitrary site. Returns the problem, or undefined when fine.
 */
export function googleMapsUrlProblem(value: string): string | undefined {
  const v = value.trim();
  if (v === '') return undefined;
  if (v.length > 500) return 'The link is too long (500 characters at most).';
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return 'Paste the full link from Google Maps, starting with https://.';
  }
  const message = 'Use a Google Maps link: open the place in Google Maps, choose Share, then Copy link.';
  if (url.protocol !== 'https:' || url.username || url.password) return message;
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  const ok =
    ((host === 'google.com' || host === 'www.google.com') && (path === '/maps' || path.startsWith('/maps/'))) ||
    host === 'maps.google.com' ||
    host === 'maps.app.goo.gl' ||
    (host === 'goo.gl' && path.startsWith('/maps'));
  return ok ? undefined : message;
}
