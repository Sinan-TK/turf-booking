/**
 * How long a unit (pitch, court, table...) can be booked: a shortest booking (the "block") and a longest one, which must
 * be a whole number of blocks. The unit's prices are per block, so a booking of n blocks costs n block prices.
 */

/** A booking can never be longer than a day. */
export const MAX_BOOKING_MINUTES = 24 * 60;

/** 60 -> "1 hour", 180 -> "3 hours", 90 -> "1 hr 30 min", 45 -> "45 min". */
function lengthText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? '1 hour' : `${h} hours`;
  return `${h} hr ${m} min`;
}

/** The first problem with a unit's shortest/longest booking, as a message for the owner, or null when it is fine. */
export function unitDurationProblem(input: {
  minMinutes: number;
  maxMinutes: number;
  /** The start grid of the unit's venue type: starts happen every this many minutes. Optional. */
  slotIntervalMin?: number;
  /** The range the Super Admin set for the unit's venue type: the unit's lengths must stay inside it. Optional. */
  facility?: { name: string; minMinutes: number; maxMinutes: number };
}): string | null {
  const { minMinutes, maxMinutes, slotIntervalMin, facility } = input;
  if (!Number.isInteger(minMinutes) || minMinutes <= 0) return 'The minimum time must be a whole number of minutes above 0.';
  if (!Number.isInteger(maxMinutes) || maxMinutes <= 0) return 'The maximum time must be a whole number of minutes above 0.';
  if (maxMinutes > MAX_BOOKING_MINUTES) return `The maximum time can't be more than ${MAX_BOOKING_MINUTES} minutes (one day).`;
  if (maxMinutes < minMinutes) return "The maximum time can't be shorter than the minimum time.";
  if (facility && (minMinutes < facility.minMinutes || maxMinutes > facility.maxMinutes)) {
    return `${facility.name} bookings can be from ${lengthText(facility.minMinutes)} to ${lengthText(facility.maxMinutes)}. Choose a shortest and a longest booking inside that.`;
  }
  if (maxMinutes % minMinutes !== 0) {
    return `The maximum time must be a multiple of the minimum time (${minMinutes} min): ${minMinutes}, ${minMinutes * 2}, ${minMinutes * 3}...`;
  }
  if (slotIntervalMin !== undefined && slotIntervalMin > 0 && minMinutes % slotIntervalMin !== 0) {
    return `The minimum time must be a multiple of ${slotIntervalMin} minutes, the gap between start times of this venue type.`;
  }
  return null;
}

/** Every booking length a unit offers: min, 2 x min, ... up to max. Empty when the pair is not valid. */
export function unitDurations(minMinutes: number, maxMinutes: number): number[] {
  if (unitDurationProblem({ minMinutes, maxMinutes }) !== null) return [];
  const out: number[] = [];
  for (let d = minMinutes; d <= maxMinutes; d += minMinutes) out.push(d);
  return out;
}
