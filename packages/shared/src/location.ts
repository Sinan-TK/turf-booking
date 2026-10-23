/** Helpers for the customer site's location picker. Pure, so they are tested with the API's suite. */

export interface TownPoint {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

const EARTH_RADIUS_KM = 6371;

/** Straight-line (great-circle) distance between two points, in km. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The listed town closest to a position, if one lies within `maxKm` (towns without a centre are skipped). */
export function nearestTown<T extends TownPoint>(towns: T[], lat: number, lng: number, maxKm = 25): T | null {
  let best: T | null = null;
  let bestKm = Infinity;
  for (const t of towns) {
    if (t.lat === null || t.lng === null) continue;
    const km = haversineKm(lat, lng, t.lat, t.lng);
    if (km < bestKm) {
      best = t;
      bestKm = km;
    }
  }
  return best && bestKm <= maxKm ? best : null;
}

/** The browser's `GeolocationPositionError` codes. */
export const GEO_ERROR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as const;

/**
 * What to tell a customer whose current location couldn't be read. `error` is the browser's error (or null when
 * the browser has no geolocation at all); `secureContext` is `window.isSecureContext` (location needs https,
 * except on localhost).
 */
export function describeGeoError(error: { code: number } | null, secureContext: boolean): string {
  if (!secureContext) {
    return 'Location only works on a secure (https) address. Open the site over https, or pick a town below.';
  }
  if (error === null) return "This browser can't share your location. Pick a town below instead.";
  switch (error.code) {
    case GEO_ERROR.PERMISSION_DENIED:
      return "Location is blocked for this site. Allow it in your browser's address-bar settings (the lock or location icon), or pick a town below.";
    case GEO_ERROR.TIMEOUT:
      return "Finding your location took too long. Check that location is switched on for your device, then try again, or pick a town below.";
    default:
      return "Your device couldn't work out where you are. Pick a town below instead.";
  }
}
