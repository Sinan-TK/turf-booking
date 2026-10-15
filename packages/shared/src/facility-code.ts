/**
 * Facility Code format: <STATE_CODE><DISTRICT_CODE><5_DIGIT_SEQUENCE>,
 * e.g. "KLMPM10001" for the Kerala launch. Segment lengths are NOT fixed
 * globally (a future country/region can use different code lengths at
 * each tier) — see schema.prisma's Country/State/District models — so
 * this module intentionally does not hardcode a strict per-segment
 * regex. It owns exactly the two things that are safe to fix platform-
 * wide: normalization (trim + uppercase) and a loose shape check, per
 * the brief's customer UX steps. The backend is the source of truth for
 * whether a normalized code actually resolves to a facility.
 */

const LOOSE_SHAPE = /^[A-Z0-9]{6,20}$/;

export function normalizeFacilityCode(input: string): string {
  return input.trim().toUpperCase();
}

/**
 * Cheap client/server pre-check before hitting the database — rejects
 * obviously-malformed input (empty, too short/long, non-alphanumeric)
 * without pretending to validate the real per-country segment structure.
 */
export function hasValidFacilityCodeShape(input: string): boolean {
  return LOOSE_SHAPE.test(normalizeFacilityCode(input));
}
