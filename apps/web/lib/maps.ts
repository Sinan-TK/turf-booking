import { googleMapsUrlProblem } from '@venue/shared/dist/maps-url';

/**
 * A venue's own Google Maps link, only if it is a real one. The server already refuses anything else when an owner saves it; this
 * checks again with the same rule before the site puts it in a link, so an unexpected value (an old record, a "javascript:" address, some
 * other site) is never followed. Returns null when there is no link or it is not trusted.
 */
export function trustedMapsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return googleMapsUrlProblem(url) === undefined ? url.trim() : null;
}
