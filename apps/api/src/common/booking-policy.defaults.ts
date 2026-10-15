/**
 * The values of a BookingPolicy row that drive slot generation and booking
 * validation. Durations/intervals are minutes.
 */
export interface BookingPolicyValues {
  slotIntervalMin: number;
  minDurationMin: number;
  maxDurationMin: number;
  durationIncrementMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  maxAdvanceDays: number;
  minLeadMinutes: number;
}

/**
 * Last-resort policy when not even a PLATFORM_DEFAULT row exists. It is
 * exactly the rules the platform ran on before venue categories (whole
 * hours, 60–180 minutes, no buffers), so football behaviour is unchanged
 * in every fallback path. Mirrors the PLATFORM_DEFAULT row in seed.ts.
 */
export const LEGACY_POLICY_DEFAULTS: BookingPolicyValues = {
  slotIntervalMin: 60,
  minDurationMin: 60,
  maxDurationMin: 180,
  durationIncrementMin: 60,
  bufferBeforeMin: 0,
  bufferAfterMin: 0,
  maxAdvanceDays: 30,
  minLeadMinutes: 0,
};

/** The durations a policy allows: min, min+inc, … up to max. */
export function allowedDurations(policy: BookingPolicyValues): number[] {
  const out: number[] = [];
  for (let d = policy.minDurationMin; d <= policy.maxDurationMin; d += policy.durationIncrementMin) {
    out.push(d);
  }
  return out;
}
