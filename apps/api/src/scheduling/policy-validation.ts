import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { allowedDurations, type BookingPolicyValues } from '../common/booking-policy.defaults';

export interface BookingTimeCheck {
  startTime: Date;
  durationMinutes: number;
  /** IANA zone of the venue — every wall-clock rule is evaluated there. */
  timezone: string;
  now?: Date;
  /** Owner walk-ins may be logged after the fact / far ahead. */
  skipLeadAndAdvance?: boolean;
}

/** Minutes between local midnight and `startTime` in the venue's zone, or
 * null when the start has seconds/milliseconds (never rounded). */
function localMinutesSinceMidnight(startTime: Date, timezone: string): number | null {
  const local = DateTime.fromJSDate(startTime, { zone: timezone });
  if (local.second !== 0 || local.millisecond !== 0) return null;
  return local.hour * 60 + local.minute;
}

/** True when `durationMinutes` is one the policy offers. */
export function isDurationAllowed(policy: BookingPolicyValues, durationMinutes: number): boolean {
  return (
    Number.isInteger(durationMinutes) &&
    durationMinutes >= policy.minDurationMin &&
    durationMinutes <= policy.maxDurationMin &&
    (durationMinutes - policy.minDurationMin) % policy.durationIncrementMin === 0
  );
}

/** True when the start sits exactly on the policy's slot grid (venue-local). */
export function isStartAligned(policy: BookingPolicyValues, startTime: Date, timezone: string): boolean {
  const minutes = localMinutesSinceMidnight(startTime, timezone);
  return minutes !== null && minutes % policy.slotIntervalMin === 0;
}

/**
 * Backend enforcement of a resolved BookingPolicy. Used by both the
 * customer hold path and the owner walk-in path (search applies the same
 * predicates when generating slots, so the two can never disagree). Throws
 * 400 and never rounds an invalid value to a valid one.
 */
export function assertPolicyAllowsBooking(policy: BookingPolicyValues, check: BookingTimeCheck): void {
  if (!isDurationAllowed(policy, check.durationMinutes)) {
    throw new BadRequestException(
      `Duration must be between ${policy.minDurationMin} and ${policy.maxDurationMin} minutes in steps of ${policy.durationIncrementMin} (allowed: ${allowedDurations(policy).join(', ')})`,
    );
  }
  if (!isStartAligned(policy, check.startTime, check.timezone)) {
    throw new BadRequestException(
      `startTime must fall on a ${policy.slotIntervalMin}-minute boundary (${check.timezone} local time)`,
    );
  }
  if (check.skipLeadAndAdvance) return;

  const now = check.now ?? new Date();
  if (check.startTime.getTime() < now.getTime() + policy.minLeadMinutes * 60_000) {
    throw new BadRequestException(
      policy.minLeadMinutes > 0
        ? `Bookings must be made at least ${policy.minLeadMinutes} minutes ahead`
        : 'startTime must be a valid future timestamp',
    );
  }
  if (check.startTime.getTime() > now.getTime() + policy.maxAdvanceDays * 86_400_000) {
    throw new BadRequestException(
      `Bookings can be made at most ${policy.maxAdvanceDays} days in advance`,
    );
  }
}

/** The range a booking's resource lock must cover: its own time plus buffers. */
export function paddedRange(
  policy: BookingPolicyValues,
  startTime: Date,
  endTime: Date,
): { start: Date; end: Date } {
  return {
    start: new Date(startTime.getTime() - policy.bufferBeforeMin * 60_000),
    end: new Date(endTime.getTime() + policy.bufferAfterMin * 60_000),
  };
}
