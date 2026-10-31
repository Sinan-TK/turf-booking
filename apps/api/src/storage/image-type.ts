/** Largest image file accepted for any upload (the apps shrink pictures before sending, so real uploads are far smaller). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The image types accepted, recognised by their first bytes rather than the name or the type the browser claims. */
export function sniffImageType(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * Where each kind of upload lives in the bucket, one top-level folder per kind, so they are easy to find, back up, expire or hand
 * different access rules to. Unit photos live under venues/<venueId>/units/..., facility pictures here.
 */
export const STORAGE_FOLDERS = {
  /** The picture of a facility (Football, Pool...) shown in the customer's "Venue types" picker: facilities/<facilityId>/<uuid>.<ext> */
  facilities: 'facilities',
  /** Advertising banners on the landing page: banners/<bannerId>/<uuid>.<ext> */
  banners: 'banners',
} as const;
