import { describeGeoError, GEO_ERROR, haversineKm, nearestTown } from '@venue/shared';

/** The customer site's location helpers (packages/shared/src/location.ts). */
const towns = [
  { id: 'kottakkal', name: 'Kottakkal', lat: 11.001, lng: 76.001 },
  { id: 'manjeri', name: 'Manjeri', lat: 11.121, lng: 76.121 },
  { id: 'tirur', name: 'Tirur', lat: 10.917, lng: 75.926 },
  { id: 'nowhere', name: 'No centre', lat: null, lng: null },
];

describe('haversineKm', () => {
  test('is zero for the same point and symmetric', () => {
    expect(haversineKm(11, 76, 11, 76)).toBe(0);
    expect(haversineKm(11.001, 76.001, 11.121, 76.121)).toBeCloseTo(haversineKm(11.121, 76.121, 11.001, 76.001), 9);
  });

  test('matches a known distance: Kottakkal to Manjeri is about 18 km', () => {
    const km = haversineKm(11.001, 76.001, 11.121, 76.121);
    expect(km).toBeGreaterThan(17);
    expect(km).toBeLessThan(19.5);
  });

  test('one degree of latitude is about 111 km', () => {
    expect(haversineKm(10, 76, 11, 76)).toBeCloseTo(111.2, 0);
  });
});

describe('nearestTown', () => {
  test('picks the closest town to a position', () => {
    expect(nearestTown(towns, 11.12, 76.12)?.name).toBe('Manjeri');
    expect(nearestTown(towns, 10.92, 75.93)?.name).toBe('Tirur');
  });

  test('returns nothing when every town is farther than the limit', () => {
    expect(nearestTown(towns, 12.97, 77.59)).toBeNull(); // Bengaluru
    expect(nearestTown(towns, 11.12, 76.12, 0.1)).toBeNull();
  });

  test('skips towns without a centre and copes with an empty list', () => {
    expect(nearestTown([towns[3]!], 11, 76)).toBeNull();
    expect(nearestTown([], 11, 76)).toBeNull();
  });
});

describe('describeGeoError', () => {
  test('explains each way the browser can fail, and what to do', () => {
    expect(describeGeoError({ code: GEO_ERROR.PERMISSION_DENIED }, true)).toMatch(/blocked for this site.*address-bar/);
    expect(describeGeoError({ code: GEO_ERROR.TIMEOUT }, true)).toMatch(/took too long/);
    expect(describeGeoError({ code: GEO_ERROR.POSITION_UNAVAILABLE }, true)).toMatch(/couldn't work out where you are/);
    expect(describeGeoError(null, true)).toMatch(/can't share your location/);
  });

  test('an insecure address is named as the cause before anything else', () => {
    expect(describeGeoError({ code: GEO_ERROR.PERMISSION_DENIED }, false)).toMatch(/secure \(https\) address/);
    expect(describeGeoError(null, false)).toMatch(/secure \(https\) address/);
  });

  test('every message points to picking a town', () => {
    for (const e of [{ code: 1 }, { code: 2 }, { code: 3 }, null]) {
      expect(describeGeoError(e, true)).toMatch(/pick a town/i);
    }
  });
});
